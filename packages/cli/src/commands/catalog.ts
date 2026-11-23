import { type OptionsResponse } from "@meterapp/car-image-sdk";
import { flagInteger, flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { cliCommandFor } from "../mcp/server.js";
import { type Io, keyValues, paint, printJson, table } from "../output.js";
import { flagColor, flagMarket, flagView } from "./images.js";

function yearsLabel(years: number[] | undefined): string {
  if (!years || years.length === 0) return "—";
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

export const searchCommand: CommandDefinition = {
  name: "search",
  summary: "Fuzzy-search the vehicle catalog (free, no key needed)",
  usage: "car-image search <query…> [--limit 10] [--year <year>] [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const query = ctx.args.positionals.join(" ").trim();
    if (!query) throw new CliError("Missing search query", 2, "Example: car-image search porsche 911");
    const limit = flagInteger(ctx.args.flags, "limit", { min: 1, max: 100 });
    const year = flagInteger(ctx.args.flags, "year", { min: 1900, max: 2100 });
    const result = await ctx.clientContext.client.searchVehicles(query, { limit, year });
    if (ctx.io.json) {
      printJson(ctx.io, result);
      return 0;
    }
    const results = result.data.results;
    if (results.length === 0) {
      ctx.io.stdout(`No catalog matches for "${query}". Try fewer words or a different spelling.\n`);
      return 1;
    }
    const rows = results.map((hit) => {
      const view = searchHitView(hit);
      return [view.kind, view.make, view.model ?? paint(ctx.io, "dim", "(make)"), yearsLabel(view.years), view.match, view.type];
    });
    ctx.io.stdout(`${table(rows, ["kind", "make", "model", "years", "match", "type"])}\n`);
    const first = results.map(searchHitView).find((hit) => hit.kind === "model" && hit.model);
    if (first?.model) {
      const year = first.years?.length ? Math.max(...first.years) : new Date().getFullYear();
      ctx.io.stdout(`\n${paint(ctx.io, "dim", `Try: ${cliCommandFor({ make: first.make, model: first.model, year })}`)}\n`);
    }
    return 0;
  },
};

export const resolveCommand: CommandDefinition = {
  name: "resolve",
  summary: "Turn free text into exact image parameters and a ready-to-run command",
  usage: "car-image resolve <free text…> [--market <country code>] [--json]\n  e.g. car-image resolve red 2024 porsche 911 side view\n  --market names the market of sale (a two-letter country code such as AU); the account's default applies without it",
  async run(ctx: CommandContext): Promise<number> {
    const query = ctx.args.positionals.join(" ").trim();
    if (!query) throw new CliError("Missing text to resolve", 2, "Example: car-image resolve red 2024 porsche 911 side view");
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` or set CAR_IMAGE_API_KEY.");
    const market = flagMarket(ctx.args.flags);
    const result = await ctx.clientContext.client.resolve(query, market ? { market } : {});
    const params = result.data.params;
    const command = cliCommandFor(params);
    if (ctx.io.json) {
      printJson(ctx.io, { ...result, cli: command });
      return 0;
    }
    const rows: Array<[string, string]> = [
      ["make", params.make],
      ["model", params.model],
      ["year", String(params.year)],
      ["view", params.view],
      ["color", params.color],
    ];
    if (params.vehicle_id) rows.push(["vehicle", params.vehicle_id]);
    if (params.size) rows.push(["size", params.size]);
    if (params.width) rows.push(["width", String(params.width)]);
    if (params.format) rows.push(["format", params.format]);
    rows.push(["confidence", String(result.data.confidence)]);
    ctx.io.stdout(`${keyValues(ctx.io, rows)}\n\nRun:\n  ${command}\n`);
    const candidates = result.data.candidates ?? [];
    if (candidates.length > 1) {
      const alternatives = candidates.slice(0, 6).map((candidate) => [
        String(candidate.make_name ?? candidate.make_slug ?? ""),
        String(candidate.model_name ?? candidate.model_slug ?? ""),
        yearsLabel(Array.isArray(candidate.years) ? candidate.years.map(Number) : undefined),
        String(candidate.match_kind ?? ""),
      ]);
      ctx.io.stdout(`\nOther candidates:\n${table(alternatives, ["make", "model", "years", "match"])}\n`);
    }
    return 0;
  },
};

/**
 * Renders `GET /api/v1/images/options` for humans. Formats and catalog sources
 * are objects on the wire (`{id, mime, transparent}` and
 * `{id, name, region, license}`) and the year span is `{from, to}`, so each is
 * projected to the fields it shows — stringifying either array whole prints
 * `[object Object]`.
 *
 * The delivery options (`fits`, `default_fit`, `backgrounds`, `trim`) are
 * optional on the wire: a server that predates them simply has no such
 * section here, rather than a section full of `undefined`.
 */
export function renderOptions(io: Pick<Io, "color">, data: OptionsResponse["data"]): string {
  const { catalog, pricing } = data;
  const sources = catalog.sources.map((source) => source.id).filter(Boolean);
  const sections: Array<string | null> = [
    `${paint(io, "bold", "Views")}\n${table(
      data.views.map((view) => [view.id, view.elevation_degrees >= 90 ? "overhead" : `${view.yaw_degrees}°`, view.label, view.description, view.aliases.length ? `aliases: ${view.aliases.join(", ")}` : ""]),
      ["id", "yaw", "label", "description", ""]
    )}`,
    `${paint(io, "bold", "Colors")}\n${table(data.colors.map((color) => [color.name, color.hex]), ["name", "hex"])}`,
    `${paint(io, "bold", "Sizes")}\n${table(
      Object.entries(data.sizes.presets).map(([name, px]) => [name, `${px} px`]).concat([["max", `${data.sizes.max} px (use --width/--height for exact sizes)`]]),
      ["preset", "size"]
    )}`,
    renderFits(io, data),
    renderBackgrounds(io, data),
    renderTrim(io, data),
    `${paint(io, "bold", "Formats")}\n${table(
      data.formats.map((format) => [format.id, format.mime, format.transparent ? "transparent" : "opaque"]),
      ["id", "mime", "background"]
    )}`,
    `${paint(io, "bold", "Pricing")}  ${renderPricing(pricing)}\n` +
      `${paint(io, "bold", "Catalog")}  ${catalog.makes.toLocaleString("en-US")} makes, ${catalog.models.toLocaleString("en-US")} models, ${catalog.years.from}–${catalog.years.to}${sources.length ? ` · sources: ${sources.join(", ")}` : ""}\n`,
  ];
  return sections.filter((section): section is string => section !== null).join("\n\n");
}

/**
 * The plans as `pricing.plans` lists them. Since 2026-10-25 a plan meters
 * vehicle images (each vehicle in each color and angle, once a month) and
 * images cost no credits; an older server's plans and the flat credit price
 * are still read. A plan without a price (Enterprise) is left out.
 */
export function renderPricing(pricing: OptionsResponse["data"]["pricing"]): string {
  const plans = (pricing.plans ?? []).filter((plan) => plan.monthly_cents !== null);
  if (plans.some((plan) => typeof plan.images_per_month === "number")) {
    const listed = plans.map((plan) => {
      const images = `${(plan.images_per_month ?? 0).toLocaleString("en-US")} vehicle images`;
      // Free's images are one allowance per account since 2026-11-11 (image_period: lifetime); older servers said a month.
      const free = plan.image_period === "lifetime" ? `${plan.name} ${images} per account` : `${plan.name} ${images}/mo`;
      return plan.monthly_cents === 0 ? free : `${plan.name} $${(plan.monthly_cents ?? 0) / 100}/mo ${images}`;
    });
    return `${listed.join(" · ")} · each image as often as you like · no overage · credits (3D, logos) come with a plan`;
  }
  const perImage = `${pricing.credits_per_image} credit per image`;
  const legacy = plans.map((plan) =>
    plan.monthly_cents === 0 ? `${plan.name} ${pricing.free_credits} credits` : `${plan.name} $${(plan.monthly_cents ?? 0) / 100}/mo ${plan.included_credits.toLocaleString("en-US")} credits`
  );
  if (legacy.length === 0) return `${perImage} · ${pricing.free_credits} free credits`;
  return `${perImage} · ${legacy.join(" · ")}`;
}

/** `--fit` only matters once both `--width` and `--height` are given; the table says what each mode does then. */
function renderFits(io: Pick<Io, "color">, data: OptionsResponse["data"]): string | null {
  if (!data.fits?.length) return null;
  const heading = `${paint(io, "bold", "Fit")}  --fit, with --width and --height${data.default_fit ? ` (default ${data.default_fit})` : ""}`;
  return `${heading}\n${table(
    data.fits.map((fit) => [fit.id, fit.description]),
    ["mode", "result"]
  )}`;
}

/** The `--background` vocabulary: the defaults per format, the named colors and the hex spellings. */
function renderBackgrounds(io: Pick<Io, "color">, data: OptionsResponse["data"]): string | null {
  const backgrounds = data.backgrounds;
  if (!backgrounds) return null;
  return `${paint(io, "bold", "Backgrounds")}  --background\n${table(
    [
      ["default", `${backgrounds.default} (jpg: ${backgrounds.jpg_default})`],
      ["named", backgrounds.named.join(", ")],
      ["hex", backgrounds.hex],
    ],
    ["value", "accepted"]
  )}`;
}

/** `--trim` and the `--padding` ceiling the server enforces. */
function renderTrim(io: Pick<Io, "color">, data: OptionsResponse["data"]): string | null {
  if (!data.trim) return null;
  return `${paint(io, "bold", "Trim")}  --trim crops to the car's own bounds before sizing, so it fills the box (recommended for non-square layouts) · --padding 0–${data.trim.padding_max_percent}% of the car's longer side with --trim, of the stored frame without it`;
}

export const optionsCommand: CommandDefinition = {
  name: "options",
  summary: "List views, colors, sizes, formats, pricing and catalog coverage",
  usage: "car-image options [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const result = await ctx.clientContext.client.options();
    if (ctx.io.json) {
      printJson(ctx.io, result);
      return 0;
    }
    ctx.io.stdout(renderOptions(ctx.io, result.data));
    return 0;
  },
};


/** Search hits may arrive camelCase (catalog lib) or snake_case (REST); normalize for display. */
export function searchHitView(hit: Record<string, unknown>): { kind: string; make: string; model: string | undefined; years: number[] | undefined; match: string; type: string } {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = hit[key];
      if (typeof value === "string" && value) return value;
    }
    return undefined;
  };
  const years = Array.isArray(hit.years) ? hit.years.map(Number).filter(Number.isFinite) : undefined;
  return {
    kind: pick("kind") ?? "model",
    make: pick("makeName", "make_name", "make") ?? "",
    model: pick("modelName", "model_name", "model"),
    years,
    match: pick("matchKind", "match_kind", "match") ?? "",
    type: pick("vehicleType", "vehicle_type", "type") ?? "",
  };
}
