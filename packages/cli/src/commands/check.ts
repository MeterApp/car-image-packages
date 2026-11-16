import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { MAX_CHECK_VEHICLES, MAX_CHECK_VIEWS_VEHICLES, type VehicleCheckResult } from "@meterapp/car-image-sdk";
import { flagChoice, flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { flagMarket } from "./images.js";
import { formatInteger, paint, printJson, table } from "../output.js";
import { answerColumns, checkedJson, parseVehicleList, writeCheckedCsv, type VehicleList } from "../vehicle-list.js";

/** Rows of the not-matched table a terminal shows; the output file has them all. */
const SHOWN = 20;
/** Rules that read a name more loosely than its spelling: worth a glance before a backfill renders them. */
const LOOSE = new Set(["trim", "badge", "fuzzy"]);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readList(path: string, format: "csv" | "json" | undefined): Promise<VehicleList> {
  let text: string;
  try {
    text = path === "-" ? await readStdin() : await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
  const byExtension = extname(path).toLowerCase() === ".json" ? "json" : extname(path).toLowerCase() === ".csv" ? "csv" : undefined;
  return parseVehicleList(text, format ?? byExtension);
}

function inputLabel(list: VehicleList, index: number): string {
  const entry = list.entries[index] ?? {};
  if (typeof entry.vehicle === "string") return entry.vehicle;
  return [entry.year, entry.make, entry.model].filter((part) => part !== undefined && part !== "").join(" ") || "(empty)";
}

/** A shell word: quoted when it holds a space ("Land Rover"), so the command runs as printed. */
function shellWord(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * The command that requests a missing vehicle (we email when it is added), filled in with
 * the first miss when its entry names a make and model; placeholders otherwise.
 */
export function requestHint(list: VehicleList, results: VehicleCheckResult[]): string {
  const miss = results.find((result) => result.status === "miss");
  const entry = miss ? list.entries[miss.index] : undefined;
  const make = typeof entry?.make === "string" ? entry.make.trim() : "";
  const model = typeof entry?.model === "string" || typeof entry?.model === "number" ? String(entry.model).trim() : "";
  const year = String(entry?.year ?? "").trim();
  const example =
    make && model
      ? `${shellWord(make)} ${shellWord(model)}${/^\d{4}$/.test(year) ? ` --year ${year}` : ""}`
      : "<Make> <Model> --year <YYYY>";
  return `Request a missing vehicle with: car-image request vehicle ${example} (you'll get an email when it's added).`;
}

function closest(result: VehicleCheckResult): string {
  if (result.status === "invalid") return result.error ?? "";
  const first = result.suggestions?.find((suggestion) => suggestion.id);
  if (first) return `${first.make}/${first.model} ${first.year} ${first.id}`;
  return result.search ? `try GET ${result.search}` : "";
}

export const checkCommand: CommandDefinition = {
  name: "check",
  aliases: ["coverage"],
  summary: "Check which vehicles of a CSV or JSON list the catalog carries, and get their ids (free)",
  usage:
    "car-image check <file.csv|file.json|-> [--views] [--market <country code>] [--out checked.csv|checked.json] [--format csv|json] [--json]\n  e.g. car-image check inventory.csv --out inventory-checked.csv\n  --views also says which of each match's nine views are prepared and which of those are verified (views_prepared, views_missing, views_verified columns)\n  --market names the market of sale the list is for (a two-letter country code such as AU); the account's default applies without it",
  async run(ctx: CommandContext): Promise<number> {
    // `--views` takes a list for `packs`, so the parser hands it the next word:
    // here it is a switch, and `check --views list.csv` names the list.
    const given = ctx.args.flags.views;
    const viewsFlag = given === "true" ? true : given === "false" ? false : given;
    if (typeof viewsFlag === "string" && ctx.args.positionals.length > 0) {
      throw new CliError("--views takes no value: it reads all nine views", 2, `Example: car-image check ${shellWord(ctx.args.positionals[0] ?? "vehicles.csv")} --views --out manifest.csv`);
    }
    const views = viewsFlag === true || typeof viewsFlag === "string";
    const path = ctx.args.positionals[0] ?? (typeof viewsFlag === "string" ? viewsFlag : undefined);
    if (!path) {
      throw new CliError("Missing the list to check", 2, "Example: car-image check vehicles.csv --out checked.csv (columns make,model,year[,ref], or vehicle for stored ids; - reads stdin)");
    }
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` or set CAR_IMAGE_API_KEY.");
    const format = flagChoice(ctx.args.flags, "format", ["csv", "json"] as const);
    const outPath = flagString(ctx.args.flags, "out");
    const list = await readList(path, format);
    const total = list.entries.length;
    const progress = !ctx.io.json && !ctx.io.quiet && total > (views ? MAX_CHECK_VIEWS_VEHICLES : MAX_CHECK_VEHICLES);
    const market = flagMarket(ctx.args.flags);
    const response = await ctx.clientContext.client.checkVehicles(list.entries, {
      views,
      ...(market ? { market } : {}),
      onProgress: progress ? (checked) => ctx.io.stderr(`${paint(ctx.io, "dim", `Checked ${formatInteger(checked)} of ${formatInteger(total)}…`)}\n`) : undefined,
    });

    // A CSV comes back as the CSV it was, with the answers beside each row; JSON (or --out *.json) as JSON.
    const writesJson = list.format === "json" || (outPath !== undefined && extname(outPath).toLowerCase() === ".json");
    if (outPath) {
      const body = writesJson ? `${JSON.stringify(checkedJson(list, response), null, 2)}\n` : writeCheckedCsv(list, response.data.results, views);
      try {
        await writeFile(outPath, body);
      } catch (error) {
        throw new CliError(`Cannot write ${outPath}: ${error instanceof Error ? error.message : String(error)}`, 1);
      }
    }
    if (ctx.io.json) {
      printJson(ctx.io, checkedJson(list, response));
      return 0;
    }

    const { summary, results } = response.data;
    const lines = [
      `Checked ${formatInteger(summary.total)} vehicle${summary.total === 1 ? "" : "s"}: ${paint(ctx.io, "green", `${formatInteger(summary.match)} match${summary.match === 1 ? "" : "es"}`)}, ${formatInteger(summary.suggestion)} with suggestions, ${formatInteger(summary.miss)} missing${summary.invalid ? `, ${paint(ctx.io, "yellow", `${formatInteger(summary.invalid)} invalid`)}` : ""}.`,
    ];
    if (summary.match) lines.push(`${formatInteger(summary.distinct_vehicles)} distinct vehicle${summary.distinct_vehicles === 1 ? "" : "s"} to render: store each vehicle_id and render by it (car-image get --vehicle <id>).`);
    if (summary.match && summary.views_complete !== undefined) {
      lines.push(`${formatInteger(summary.views_complete)} of ${formatInteger(summary.distinct_vehicles)} with all nine views prepared${outPath && !writesJson ? " (views_prepared and views_missing columns)" : ""}; the other views are prepared when first requested.`);
    }
    // Only when there is something to say: a view that is not verified yet is not a finding.
    if (summary.match && summary.views_verified) {
      lines.push(`${formatInteger(summary.views_verified)} with every prepared view verified${outPath && !writesJson ? " (views_verified column)" : ""}.`);
    }
    const loose = results.filter((result) => result.vehicle && LOOSE.has(result.vehicle.match)).length;
    if (loose) lines.push(paint(ctx.io, "dim", `${formatInteger(loose)} matched by a looser reading of the name (trim words, a badge or a typo): worth a glance.`));
    const unmatched = results.filter((result) => result.status !== "match");
    if (unmatched.length) {
      const rows = unmatched.slice(0, SHOWN).map((result) => [String(result.index + 1), inputLabel(list, result.index), result.status, result.reason ?? "", closest(result)]);
      lines.push(
        "",
        `${paint(ctx.io, "bold", "Not matched")}${unmatched.length > SHOWN ? ` (first ${SHOWN} of ${formatInteger(unmatched.length)})` : ""}`,
        table(rows, ["#", "entry", "status", "reason", "closest or fix"]),
        paint(ctx.io, "dim", "A suggestion is another vehicle (the model in its nearest year, a related model): use it only if it is the car you mean. Skip a miss in every view and color.")
      );
    }
    if (summary.miss) lines.push(requestHint(list, results));
    lines.push(
      "",
      outPath
        ? `Wrote ${outPath}: every entry with its answer${writesJson ? " (vehicle.id is the id to store)" : ` (the ${answerColumns(list)[1]} column is the id to store)`}.`
        : paint(ctx.io, "dim", `Add --out checked.${list.format === "json" ? "json" : "csv"} to save every entry with its vehicle id.`)
    );
    ctx.io.stdout(`${lines.join("\n")}\n`);
    return 0;
  },
};
