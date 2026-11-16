import { readFile, writeFile } from "node:fs/promises";
import { ASPECT_RATIOS, COLORS, FITS, FRAMINGS, MARKET_PATTERN, MAX_PADDING_PERCENT, REQUEST_FORMATS, RESOLUTIONS, SIZES, VIEWS, isColor, isHexColor, parseView, suggestedFileName, type ImageParams, type MakeLogoParams, type Size, type VehicleSelector, type View } from "@meterapp/car-image-sdk";
import { MAKE_LOGO_NOTICE } from "@meterapp/car-image-sdk/mcp";
import { flagBoolean, flagChoice, flagInteger, flagString, requireString, type FlagValue } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { ok, printJson } from "../output.js";

const SIZE_NAMES = Object.keys(SIZES) as Size[];

const VEHICLE_HINT = "Example: --make Porsche --model 911 --year 2024, or --vehicle veh_395yw8tn73ff8";

/**
 * `--color`: one of the fifteen presets in any case (`grey` is `gray`), any
 * other CSS color name (`navy`), or a hex paint such as `#1a2b3c`, `1a2b3c`
 * or `#abc`. Names are lowercased; a hex is passed as written and the SDK
 * spells it for the wire.
 */
export function flagColor(flags: Record<string, FlagValue>, name = "color"): string | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!isColor(trimmed)) {
    throw new CliError(`Invalid --${name} "${value}". Choose one of: ${COLORS.join(", ")}, a CSS color name such as navy, or a hex paint such as #1a2b3c`, 2);
  }
  return isHexColor(trimmed) ? trimmed : trimmed.toLowerCase();
}

/**
 * `--view`: one of the nine angles, or any alias the API reads (`left`,
 * `front-right`, `hero`) in any case, sent as the angle it names.
 */
export function flagView(flags: Record<string, FlagValue>): View | undefined {
  const value = flagString(flags, "view");
  if (value === undefined) return undefined;
  const view = parseView(value);
  if (!view) {
    throw new CliError(`Invalid --view "${value}". Choose one of: ${VIEWS.join(", ")}, or an alias such as left, right or front-left`, 2);
  }
  return view;
}

/**
 * `--market`: the market of sale, an ISO 3166-1 alpha-2 country code in any
 * case (`AU`, `gb`), sent in upper case. The server checks the code is a
 * country's; without the flag the account's default market applies.
 */
export function flagMarket(flags: Record<string, FlagValue>): string | undefined {
  const value = flagString(flags, "market");
  if (value === undefined) return undefined;
  if (!MARKET_PATTERN.test(value.trim())) {
    throw new CliError(`Invalid --market "${value}". Send the market of sale as a two-letter country code such as US, GB, DE, AU or JP`, 2);
  }
  return value.trim().toUpperCase();
}

/**
 * Which vehicle: `--vehicle veh_…` (a stable id from `search`, `resolve` or
 * `vin`) or `--make/--model/--year`. The two are exclusive; the server would
 * refuse both, so the CLI does first with a usage error.
 */
export function vehicleFromFlags(flags: Record<string, FlagValue>, options: { requireVehicle?: boolean } = {}): VehicleSelector {
  const vehicle = flagString(flags, "vehicle")?.trim();
  const make = flagString(flags, "make");
  const model = flagString(flags, "model");
  const year = flagString(flags, "year");
  if (vehicle) {
    if (make !== undefined || model !== undefined || year !== undefined) {
      throw new CliError("Use either --vehicle or --make/--model/--year, not both", 2, VEHICLE_HINT);
    }
    return { vehicle };
  }
  const require = options.requireVehicle !== false;
  return {
    make: require ? requireString(flags, "make", VEHICLE_HINT) : (make ?? ""),
    model: require ? requireString(flags, "model", VEHICLE_HINT) : (model ?? ""),
    year: require ? requireString(flags, "year", VEHICLE_HINT) : (year ?? ""),
  };
}

/** Builds ImageParams from --vehicle or --make/--model/--year, plus --view/--color/--size/--width/--height/--fit/--background/--framing/--trim/--padding/--shadow/--format/--market. */
export function imageParamsFromFlags(flags: Record<string, FlagValue>, options: { requireVehicle?: boolean } = {}): ImageParams {
  const params: ImageParams = { ...vehicleFromFlags(flags, options) };
  const view = flagView(flags);
  if (view) params.view = view;
  const color = flagColor(flags);
  if (color) params.color = color;
  // A preset for --trim/--padding; the server spells it out, so it bills and caches as they would.
  const framing = flagChoice(flags, "framing", FRAMINGS);
  if (framing) {
    if (flags.trim !== undefined || flags.padding !== undefined) throw new CliError("--framing replaces --trim and --padding: send one or the other", 2);
    params.framing = framing;
  }
  if (flagBoolean(flags, "shadow")) params.shadow = true;
  const market = flagMarket(flags);
  if (market) params.market = market;
  const aspectRatio = flagChoice(flags, "aspect-ratio", ASPECT_RATIOS);
  if (aspectRatio) params.aspectRatio = aspectRatio;
  const resolution = flagChoice(flags, "resolution", Object.keys(RESOLUTIONS) as readonly (keyof typeof RESOLUTIONS)[]);
  if (resolution) params.resolution = resolution;
  if ((aspectRatio || resolution) && flags.size !== undefined) throw new CliError("--size names the box too: send --size or --aspect-ratio/--resolution, not both", 2);
  return { ...params, ...imageTransformFromFlags(flags, false) };
}

function imageTransformFromFlags(flags: Record<string, FlagValue>, paddingNeedsTrim = true): Omit<MakeLogoParams, "make"> {
  const params: Omit<MakeLogoParams, "make"> = {};
  const size = flagChoice(flags, "size", SIZE_NAMES);
  if (size) params.size = size;
  // Above the stored image's own size the server clamps it (a box keeps its shape) and says so; the saved file is what was served.
  const width = flagInteger(flags, "width", { min: 1 });
  if (width !== undefined) params.width = width;
  const height = flagInteger(flags, "height", { min: 1 });
  if (height !== undefined) params.height = height;
  const fit = flagChoice(flags, "fit", FITS);
  if (fit) params.fit = fit;
  const background = flagString(flags, "background");
  if (background) params.background = background;
  if (flagBoolean(flags, "trim")) params.trim = true;
  const padding = flagInteger(flags, "padding", { min: 0, max: MAX_PADDING_PERCENT });
  if (padding !== undefined) {
    if (paddingNeedsTrim && !params.trim) throw new CliError("--padding only applies with --trim", 2);
    params.padding = padding;
  }
  const rawFormat = flagString(flags, "format");
  if (rawFormat) {
    const normalized = rawFormat.toLowerCase() === "jpeg" ? "jpg" : rawFormat.toLowerCase();
    if (!(REQUEST_FORMATS as readonly string[]).includes(normalized)) throw new CliError(`Invalid --format "${rawFormat}". Choose one of: ${REQUEST_FORMATS.join(", ")}`, 2);
    params.format = normalized as ImageParams["format"];
  }
  return params;
}

/** What a billing body says, in one clause: the vehicle-image meter's month, or the credit meter's charge. */
export function billingClause(billing: { credits_charged: number; credits_remaining?: number; vehicle_images?: { used: number; included: number | null } }): string {
  const of = (count: { used: number; included: number | null }) => `${count.used.toLocaleString("en-US")} of ${count.included === null ? "unlimited" : count.included.toLocaleString("en-US")}`;
  if (billing.vehicle_images) {
    return `${of(billing.vehicle_images)} vehicle images this month`;
  }
  return `charged ${billing.credits_charged} credit${billing.credits_charged === 1 ? "" : "s"}, ${billing.credits_remaining?.toLocaleString("en-US") ?? "?"} remaining`;
}

export const getCommand: CommandDefinition = {
  name: "get",
  summary: "Download one image (one vehicle image of the month on a plan) or print a signed URL with --url",
  usage:
    "car-image get (--make <make> --model <model> --year <year> | --vehicle <veh_…>) [--view front-3-4] [--color silver|<hex>]\n               [--size thumb|small|medium|large | --width <px> [--height <px>] [--fit contain|cover|inside]] [--aspect-ratio 16:9] [--resolution hd]\n               [--background transparent|white|black|<hex>] [--framing consistent|tight|balanced | --trim [--padding <0-50>]] [--shadow] [--format png|webp|jpg|auto]\n               [--market <country code>] [--out <file> | --out -] [--url] [--json]\n" +
    `  --view takes one of the nine angles: ${VIEWS.join(", ")} (left, right, front-left and the other corners work too)\n` +
    "  --color takes one of the 15 presets, a CSS color name (navy) or any paint as hex (#1a2b3c, 1a2b3c, #abc); --background takes the same names and hex\n" +
    "  --width and --height are delivered up to the stored image's own size (1024 px square for older renders, up to 2560 px for new ones; a box keeps its shape); --vehicle takes a stable id from search, resolve or vin\n" +
    `  --aspect-ratio ${ASPECT_RATIOS.join("|")} and --resolution ${Object.keys(RESOLUTIONS).join("|")} are presets for the box; --width and --height win; not with --size\n` +
    "  --padding without --trim pads the stored frame\n" +
    "  --framing tight fills the box with the whole car (= --trim), balanced keeps even 6% margins (= --trim --padding 6),\n" +
    "  consistent (the default) keeps one apparent scale across a vehicle's views; not with --trim or --padding\n" +
    "  --shadow adds a soft ground shadow under the car, drawn from its cut-out (same image, nothing extra)\n" +
    "  --market names the market of sale (a two-letter country code such as AU), for model years that look different in different markets;\n" +
    "  today every market gets the default appearance and the answer says which was served; the same image is counted once under any market",
  run: (ctx) => runImageCommand(ctx),
};

async function runImageCommand(ctx: CommandContext, isLogo = false): Promise<number> {
  const { io, clientContext } = ctx;
  if (isLogo) {
    for (const flag of ["vehicle", "model", "year", "view", "color", "framing", "shadow", "market", "url", "batch", "prompt"]) {
      if (ctx.args.flags[flag] !== undefined) throw new CliError(`--${flag} is not supported for make logos`, 2);
    }
  }
  const params = isLogo
    ? { make: requireString(ctx.args.flags, "make"), ...imageTransformFromFlags(ctx.args.flags) }
    : imageParamsFromFlags(ctx.args.flags);
  if (!clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` or set CAR_IMAGE_API_KEY.");

  if (flagBoolean(ctx.args.flags, "url")) {
    const result = await clientContext.client.getImageUrl(params as ImageParams);
    if (io.json) {
      printJson(io, result);
    } else {
      io.stdout(`${result.data.url}\n`);
      if (!io.quiet) {
        io.stderr(`Expires ${result.data.expires_at} · ${billingClause(result.billing)} · request ${result.request_id}\n`);
      }
    }
    return 0;
  }

  const image = isLogo
    ? await clientContext.client.getMakeLogo(params as MakeLogoParams)
    : await clientContext.client.getImage(params as ImageParams);
  const format = formatFromContentType(image.contentType);
  const logoName = `${(params.make ?? "make").normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "make"}-logo.${format}`;
  const out = flagString(ctx.args.flags, "out") ?? (isLogo ? logoName : suggestedFileName({ ...params as ImageParams, format }));
  if (out === "-") {
    process.stdout.write(Buffer.from(image.bytes));
  } else {
    await writeFile(out, Buffer.from(image.bytes));
  }
  const meta = {
    file: out === "-" ? null : out,
    bytes: image.bytes.byteLength,
    content_type: image.contentType,
    width: image.width,
    height: image.height,
    source: image.source,
    credits_charged: image.creditsCharged,
    // The vehicle-image meter's month (X-Vehicle-Images-*), or the credit meter's balance.
    ...(image.usage
      ? { vehicle_images: image.usage.vehicleImages }
      : { credits_remaining: image.creditsRemaining }),
    request_id: image.requestId,
    // The catalog vehicle served (X-Vehicle-Id), as --url and the MCP tools name it.
    ...(isLogo ? { notice: MAKE_LOGO_NOTICE } : { vehicle_id: image.vehicleId }),
    // Which appearance was served (X-Vehicle-Appearance), when the server says.
    ...(!isLogo && image.appearance ? { appearance: image.appearance } : {}),
  };
  if (io.json) {
    if (out === "-") io.stderr(`${JSON.stringify(meta)}\n`);
    else printJson(io, meta);
    return 0;
  }
  const size = image.width && image.height ? `${image.width}×${image.height} ` : "";
  const line = `${out === "-" ? "Wrote image to stdout" : `Saved ${out}`} (${size}${image.contentType.replace("image/", "")}, ${(image.bytes.byteLength / 1024).toFixed(1)} KB, ${image.source ?? "unknown"}) — ${image.usage ? billingClause({ credits_charged: 0, vehicle_images: image.usage.vehicleImages }) : `charged ${image.creditsCharged ?? "?"} credit, ${image.creditsRemaining?.toLocaleString("en-US") ?? "?"} remaining`}${image.requestId ? ` · request ${image.requestId}` : ""}`;
  (out === "-" ? io.stderr : io.stdout)(`${ok(io, line)}\n`);
  if (isLogo && !io.quiet) io.stderr(`${MAKE_LOGO_NOTICE}\n`);
  if (!isLogo && !io.quiet && image.requestId && out !== "-") {
  }
  return 0;
}

export const logoCommand: CommandDefinition = {
  name: "logo",
  summary: "Download a catalog make logo (1 credit per delivery; third-party trademarks)",
  usage: "car-image logo --make <make> [--size thumb|small|medium|large] [--width <px>] [--height <px>]\n                [--fit contain|cover|inside] [--background transparent|white|black|<hex>]\n                [--trim [--padding <0-50>]] [--format png|webp|jpg|auto] [--out <file>|-] [--json]\n" + MAKE_LOGO_NOTICE,
  run: (ctx) => runImageCommand(ctx, true),
};

function formatFromContentType(contentType: string): ImageParams["format"] {
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return "png";
}

async function readBatch(path: string): Promise<ImageParams[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`Cannot read batch file ${path}: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`Batch file ${path} is not valid JSON`, 2, 'Expected an array of {"make","model","year",...} or {"vehicle",...} objects, or {"images":[...]}.');
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { images?: unknown }).images) ? (parsed as { images: unknown[] }).images : null;
  if (!list) throw new CliError(`Batch file ${path} must contain an array or an {"images": [...]} object`, 2);
  if (list.length < 1 || list.length > 50) throw new CliError(`Batch file must contain 1 to 50 images (found ${list.length})`, 2);
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new CliError(`Batch entry ${index} is not an object`, 2);
    const record = entry as Record<string, unknown>;
    const make = record.make ?? record.brand;
    let params: ImageParams;
    if (typeof record.vehicle === "string" && record.vehicle.trim()) {
      params = { vehicle: record.vehicle.trim() };
    } else if (typeof make === "string" && typeof record.model === "string" && (typeof record.year === "number" || typeof record.year === "string")) {
      params = { make, model: record.model, year: record.year };
    } else {
      throw new CliError(`Batch entry ${index} needs make, model and year, or a vehicle id`, 2);
    }
    for (const key of ["view", "color", "size", "fit", "background", "framing", "format"] as const) {
      if (typeof record[key] === "string") (params as unknown as Record<string, unknown>)[key] = record[key];
    }
    for (const key of ["width", "height", "padding"] as const) {
      if (typeof record[key] === "number") params[key] = record[key];
    }
    if (typeof record.aspectRatio === "string") params.aspectRatio = record.aspectRatio as ImageParams["aspectRatio"];
    if (typeof record.aspect_ratio === "string") params.aspectRatio = record.aspect_ratio as ImageParams["aspectRatio"];
    if (typeof record.resolution === "string") params.resolution = record.resolution as ImageParams["resolution"];
    if (record.trim === true) params.trim = true;
    if (record.shadow === true) params.shadow = true;
    return params;
  });
}

export const urlCommand: CommandDefinition = {
  name: "url",
  summary: "Create signed, key-free delivery URLs (each counts its vehicle image of the month) for browsers and documents",
  usage:
    "car-image url (--make <make> --model <model> --year <year> | --vehicle <veh_…>) [--view] [--color silver|<hex>] [--size|--width|--height] [--fit] [--background] [--framing|--trim] [--shadow] [--format] [--market <country code>]\n               [--ttl 3600] [--max-uses 0] [--renew [--renew-days 365]] [--idempotency-key <key>] [--json]\ncar-image url --batch images.json [--market <country code>] [--ttl 3600] [--max-uses 0] [--renew [--renew-days 365]] [--idempotency-key <key>] [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const { io, clientContext } = ctx;
    if (!clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` or set CAR_IMAGE_API_KEY.");
    const batchPath = flagString(ctx.args.flags, "batch");
    const images = batchPath ? await readBatch(batchPath) : [imageParamsFromFlags(ctx.args.flags)];
    const ttlSeconds = flagInteger(ctx.args.flags, "ttl", { min: 60, max: 604800 });
    const maxUses = flagInteger(ctx.args.flags, "max-uses", { min: 0, max: 1000 });
    // --renew (boolean flag): keep the URL alive past the TTL, renewing in each
    // opened window (email, CMS pages, documents; one credit per window on the
    // legacy credit meter). --renew-days bounds it; the
    // server defaults to 365.
    const renew = ctx.args.flags.renew === true ? true : undefined;
    const renewDays = flagInteger(ctx.args.flags, "renew-days", { min: 1, max: 365 });
    // --idempotency-key makes a retry from another process replay the first
    // answer instead of billing again; the SDK generates one per call anyway.
    const idempotencyKey = flagString(ctx.args.flags, "idempotency-key");
    // With --batch, --market is the market of every entry that names none of its own.
    const market = batchPath ? flagMarket(ctx.args.flags) : undefined;
    const result = await clientContext.client.createImageUrls(images, { ttlSeconds, maxUses, renew, renewDays, idempotencyKey, market });
    if (io.json) {
      printJson(io, result);
      return 0;
    }
    for (const entry of result.data) io.stdout(`${entry.url}\n`);
    if (!io.quiet) {
      const first = result.data[0];
      io.stderr(
        `${result.data.length} URL${result.data.length === 1 ? "" : "s"}${first ? `, expire ${first.expires_at}, max uses ${first.max_uses === 0 ? "unlimited" : first.max_uses}` : ""} · ${billingClause(result.billing)} · request ${result.request_id}\n`
      );
    }
    return 0;
  },
};
