import type { VinResult } from "@meterapp/car-image-sdk";
import { flagInteger } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError, fixHintFor } from "../errors.js";
import { type Io, keyValues, paint, printJson, table } from "../output.js";

const SIGN_IN_HINT = "Run `car-image login` or set CAR_IMAGE_API_KEY.";

/**
 * The hint under a `car-image vin` error. A VIN NHTSA cannot place (404) needs
 * re-checking, not the catalog search the generic 404 hint suggests. NHTSA's
 * data covers vehicles made for the US market, so a correctly typed VIN from
 * another market is a 404 too. Every other status gets the generic hint.
 */
export function vinFixHint(status: number | null | undefined, retryAfterSeconds?: number | null): string | undefined {
  if (status === 404) {
    return "Re-check the VIN, above all the first three characters (the maker code), or put * in each position you are unsure of and add --year (`car-image vin \"1HGCM826*3A\" --year 2003`). NHTSA's data covers vehicles made for the US market; for any other car, try `car-image search <make model>`.";
  }
  return fixHintFor(status, retryAfterSeconds);
}

function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/** "6-cyl 3.0 L 244 hp J30A4", from whichever parts the decoder knew. */
export function engineLabel(engine: VinResult["engine"]): string {
  const parts = [
    engine.cylinders === null ? null : `${engine.cylinders}-cyl`,
    engine.displacement_l === null ? null : `${engine.displacement_l} L`,
    engine.hp === null ? null : `${engine.hp} hp`,
    engine.model,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : "—";
}

/** "Automatic, 5 speeds" or "—". */
export function transmissionLabel(transmission: VinResult["transmission"]): string {
  const parts = [transmission.style, transmission.speeds === null ? null : `${transmission.speeds} speeds`].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : "—";
}

/** The decoded VIN for humans: the headline fields, the decoder's notes, and the catalog vehicle with a ready command. */
export function renderVin(io: Pick<Io, "color">, result: VinResult): string {
  const rows: Array<[string, string]> = [
    ["vin", result.vin],
    ["valid", result.valid ? "yes" : "no"],
    ["year", dash(result.year)],
    ["make", dash(result.make)],
    ["model", dash(result.model)],
    ["trim", dash(result.trim)],
    ["series", dash(result.series)],
    ["body", dash(result.body_class)],
    ["type", dash(result.vehicle_type)],
    ["doors", dash(result.doors)],
    ["drive", dash(result.drive_type)],
    ["fuel", dash(result.fuel_type)],
    ["engine", engineLabel(result.engine)],
    ["transmission", transmissionLabel(result.transmission)],
    ["manufacturer", dash(result.manufacturer)],
    ["plant", [result.plant.city, result.plant.state, result.plant.country].filter(Boolean).join(", ") || "—"],
    ["gvwr", dash(result.gvwr)],
    ["source", result.source],
  ];
  const sections = [keyValues(io, rows)];
  if (result.errors.length) {
    const notes = table(
      result.errors.map((error) => [String(error.code), error.text]),
      ["code", "note"]
    );
    sections.push(`${paint(io, "yellow", "Decoder notes")}\n${notes}${result.suggested_vin ? `\nSuggested VIN: ${result.suggested_vin}` : ""}`);
  }
  if (result.vehicle) {
    const vehicle = result.vehicle;
    sections.push(
      `${paint(io, "bold", "Catalog vehicle")}  ${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.id}\n\nRun:\n  car-image get --vehicle ${vehicle.id}\n  car-image 3d create --vehicle ${vehicle.id} --wait`
    );
  } else {
    sections.push(paint(io, "dim", "Not in the image catalog. Try: car-image search <make model>."));
  }
  return sections.join("\n\n");
}

export const vinCommand: CommandDefinition = {
  name: "vin",
  summary: "Decode a VIN (free) and name the catalog vehicle it maps to, with the id that renders it",
  usage:
    "car-image vin <VIN> [--year <year>] [--json]\n  e.g. car-image vin 1HGCM82633A004352\n       car-image vin \"1HGCM826*3A\" --year 2003   (a partial VIN: at least 5 characters, * for each unknown position)",
  fixHint: vinFixHint,
  async run(ctx: CommandContext): Promise<number> {
    const vin = ctx.args.positionals.join("").trim();
    if (!vin) throw new CliError("Missing VIN", 2, "Example: car-image vin 1HGCM82633A004352");
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
    const year = flagInteger(ctx.args.flags, "year", { min: 1900, max: 2100 });
    const result = await ctx.clientContext.client.decodeVin(vin, { year });
    if (ctx.io.json) {
      printJson(ctx.io, result);
      return 0;
    }
    ctx.io.stdout(`${renderVin(ctx.io, result.data)}\n`);
    return 0;
  },
};
