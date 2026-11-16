import {
  ASPECT_RATIOS,
  COLORS,
  CSS_COLOR_NAMES,
  FRAMINGS,
  HEX_COLOR_PATTERN,
  MARKET_PATTERN,
  MAX_PADDING_PERCENT,
  RESOLUTIONS,
  SIZES,
  VIEW_ALIASES,
  VIEWS,
  type Color,
  type ImageParams,
  type MakeLogoParams,
  type ImageRequestBody,
  type PresetColor,
  type VehicleSelector,
  type View,
  type Year,
} from "./types.js";

/** Coerces a year to an integer, throwing a `TypeError` for anything else. */
export function normalizeYear(year: Year): number {
  const value = typeof year === "number" ? year : Number(String(year).trim());
  if (!Number.isInteger(value) || value < 1000 || value > 9999) {
    throw new TypeError(`Invalid year "${String(year)}": expected a four-digit model year such as 2024`);
  }
  return value;
}

/** Whether a string names one of the fifteen presets, in any case. */
export function isPresetColor(value: string): value is PresetColor {
  return (COLORS as readonly string[]).includes(value.trim().toLowerCase());
}

/** Whether a string is a hex paint: `#rrggbb`, `rrggbb`, `#rgb` or `rgb`. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim());
}

/** Separators do not matter in a color or view name: `Light Grey`, `light-grey` and `lightgrey` agree. */
const nameKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");

const CSS_NAMES = new Set(CSS_COLOR_NAMES);

/** Whether a string is a CSS color name (`navy`, `Light Grey`), which the API reads as its CSS hex. */
export function isCssColorName(value: string): boolean {
  return CSS_NAMES.has(nameKey(value));
}

/**
 * Whether a value is a color the API accepts: a preset name, `grey` (the
 * `gray` preset), any other CSS color name, or a hex paint.
 */
export function isColor(value: unknown): value is Color {
  return typeof value === "string" && (isPresetColor(value) || isHexColor(value) || isCssColorName(value));
}

const VIEW_SPELLINGS = new Map<string, View>(
  VIEWS.flatMap((view) => [view, ...VIEW_ALIASES[view]].map((spelling) => [nameKey(spelling), view] as const))
);

/**
 * The view a spelling names, as the server reads it: a view id or any alias
 * in {@link VIEW_ALIASES} (`left`, `front-right`, `hero`), in any case and
 * with any separators. Null for anything else.
 */
export function parseView(value: string): View | null {
  return VIEW_SPELLINGS.get(nameKey(value)) ?? null;
}

/**
 * The wire spelling of a color: a preset or CSS color name lowercased, or a
 * hex paint bare (`1a2b3c`), which is the canonical form in query strings,
 * where a `#` would need escaping. JSON bodies accept either spelling.
 */
export function colorParam(color: Color): string {
  const value = String(color).trim();
  return isHexColor(value) ? value.replace(/^#/, "").toLowerCase() : value.toLowerCase();
}

function assertColor(color: unknown): void {
  if (!isColor(color)) {
    throw new TypeError(`Invalid color "${String(color)}": expected one of ${COLORS.join(", ")}, a CSS color name such as navy, or a hex paint such as #1a2b3c`);
  }
}

/** A size is any whole number of pixels from 1; the server clamps one above 1024 and says so. */
function assertDimension(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Invalid ${name} ${String(value)}: expected a whole number of pixels, 1 or more (sizes above 1024 are delivered at 1024)`);
  }
}

/**
 * Either a vehicle id or all of make, model and year must be present. Both
 * together are sent as given; the server answers 400 to that.
 */
export function assertVehicleSelector(selector: VehicleSelector): void {
  if (!selector || typeof selector !== "object") throw new TypeError("Vehicle params must be an object");
  if (selector.vehicle !== undefined) {
    if (typeof selector.vehicle !== "string" || !selector.vehicle.trim()) {
      throw new TypeError("vehicle must be a vehicle id such as veh_395yw8tn73ff8");
    }
    return;
  }
  const hint = " (or pass the vehicle's id as vehicle)";
  if (typeof selector.make !== "string" || !selector.make.trim()) throw new TypeError(`make is required${hint}`);
  if (typeof selector.model !== "string" || !selector.model.trim()) throw new TypeError(`model is required${hint}`);
  if (selector.year === undefined) throw new TypeError(`year is required${hint}`);
  normalizeYear(selector.year);
}

/** Client-side sanity checks; enums are validated by the server (which accepts aliases). */
export function assertImageParams(params: ImageParams): void {
  assertVehicleSelector(params);
  if (params.color !== undefined) assertColor(params.color);
  assertDimension(params.width, "width");
  assertDimension(params.height, "height");
  if (params.framing !== undefined) {
    if (!(FRAMINGS as readonly string[]).includes(params.framing)) {
      throw new RangeError(`Invalid framing ${String(params.framing)}: expected one of ${FRAMINGS.join(", ")}`);
    }
    if (params.trim !== undefined || params.padding !== undefined) {
      throw new TypeError("framing replaces trim and padding: send one or the other, not both");
    }
  }
  if (params.padding !== undefined) {
    if (!Number.isInteger(params.padding) || params.padding < 0 || params.padding > MAX_PADDING_PERCENT) {
      throw new RangeError(`Invalid padding ${String(params.padding)}: expected a whole percentage between 0 and ${MAX_PADDING_PERCENT}`);
    }
  }
  if (params.aspectRatio !== undefined && !(ASPECT_RATIOS as readonly string[]).includes(params.aspectRatio)) {
    throw new RangeError(`Invalid aspectRatio ${String(params.aspectRatio)}: expected one of ${ASPECT_RATIOS.join(", ")}`);
  }
  if (params.resolution !== undefined && !Object.hasOwn(RESOLUTIONS, params.resolution)) {
    throw new RangeError(`Invalid resolution ${String(params.resolution)}: expected one of ${Object.keys(RESOLUTIONS).join(", ")}`);
  }
  if (params.size !== undefined && (params.aspectRatio !== undefined || params.resolution !== undefined)) {
    throw new TypeError("size, aspectRatio and resolution each name the box: send size or the presets, not both");
  }
  if (params.background !== undefined && (typeof params.background !== "string" || !params.background.trim())) {
    throw new TypeError("background must be a color such as #f4f4f4, white, whitesmoke or transparent");
  }
  if (params.market !== undefined) normalizeMarket(params.market);
}

/**
 * A market of sale as the API echoes it: two letters, upper case. Throws for
 * anything else; whether the code is an assigned country is the server's check.
 */
export function normalizeMarket(market: unknown): string {
  if (typeof market !== "string" || !MARKET_PATTERN.test(market.trim())) {
    throw new TypeError("market must be an ISO 3166-1 alpha-2 country code such as US, GB, DE, AU or JP");
  }
  return market.trim().toUpperCase();
}

/**
 * The JSON fields that name a vehicle: `{ vehicle }` or `{ make, model, year }`.
 * Whatever the caller gave is sent; the server rejects both together.
 */
export function vehicleRequestBody(selector: VehicleSelector): Pick<ImageRequestBody, "vehicle" | "make" | "model" | "year"> {
  assertVehicleSelector(selector);
  const body: Pick<ImageRequestBody, "vehicle" | "make" | "model" | "year"> = {};
  if (selector.vehicle !== undefined) body.vehicle = selector.vehicle.trim();
  if (selector.make !== undefined) body.make = String(selector.make).trim();
  if (selector.model !== undefined) body.model = String(selector.model).trim();
  if (selector.year !== undefined) body.year = normalizeYear(selector.year);
  return body;
}

/** Query string for GET /api/v1/images/car. */
export function imageSearchParams(params: ImageParams): URLSearchParams {
  assertImageParams(params);
  const search = new URLSearchParams();
  if (params.vehicle !== undefined) search.set("vehicle", params.vehicle.trim());
  if (params.make !== undefined) search.set("make", String(params.make).trim());
  if (params.model !== undefined) search.set("model", String(params.model).trim());
  if (params.year !== undefined) search.set("year", String(normalizeYear(params.year)));
  if (params.view) search.set("view", params.view);
  // The canonical URL spelling of a hex paint drops the `#`, which would otherwise need escaping.
  if (params.color) search.set("color", colorParam(params.color));
  if (params.size) search.set("size", params.size);
  if (params.width !== undefined) search.set("w", String(params.width));
  if (params.height !== undefined) search.set("h", String(params.height));
  if (params.fit) search.set("fit", params.fit);
  // Likewise for the background.
  if (params.background) search.set("background", params.background.trim().replace(/^#/, ""));
  if (params.aspectRatio) search.set("aspect_ratio", params.aspectRatio);
  if (params.resolution) search.set("resolution", params.resolution);
  if (params.framing) search.set("framing", params.framing);
  if (params.trim) search.set("trim", "1");
  if (params.padding) search.set("padding", String(params.padding));
  if (params.shadow) search.set("shadow", "1");
  if (params.format) search.set("format", params.format);
  if (params.market !== undefined) search.set("market", normalizeMarket(params.market));
  return search;
}

/** JSON image object for POST /api/v1/image-urls and POST /api/v1/feedback. */
export function imageRequestBody(params: ImageParams): ImageRequestBody {
  assertImageParams(params);
  const body: ImageRequestBody = vehicleRequestBody(params);
  if (params.view) body.view = params.view;
  // JSON takes a hex paint with or without the `#`; it is sent as written.
  if (params.color) body.color = String(params.color).trim();
  if (params.width !== undefined) body.width = params.width;
  else if (params.size && params.height === undefined) body.width = SIZES[params.size];
  if (params.height !== undefined) body.height = params.height;
  if (params.fit) body.fit = params.fit;
  if (params.background) body.background = params.background.trim();
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.resolution) body.resolution = params.resolution;
  if (params.framing) body.framing = params.framing;
  if (params.trim) body.trim = true;
  if (params.padding) body.padding = params.padding;
  if (params.shadow) body.shadow = true;
  if (params.format) body.format = params.format;
  if (params.market !== undefined) body.market = normalizeMarket(params.market);
  return body;
}

/** A tidy default file name such as `2024-porsche-911-front-3-4-red.png` (a hex paint appears bare: `…-1a2b3c.png`). */
export function suggestedFileName(params: ImageParams): string {
  const slug = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const vehicle =
    params.make !== undefined && params.model !== undefined && params.year !== undefined
      ? [String(normalizeYear(params.year)), slug(String(params.make)), slug(String(params.model))]
      : [String(params.vehicle ?? "vehicle").trim()];
  const parts = [...vehicle, params.view ?? "front-3-4"];
  const color = params.color === undefined ? undefined : colorParam(params.color);
  if (color && color !== "silver") parts.push(color);
  const extension = params.format ?? "png";
  return `${parts.filter(Boolean).join("-")}.${extension}`;
}

/** Query string for a make logo, sharing image transforms without a vehicle selector. */
export function makeLogoSearchParams(params: MakeLogoParams): URLSearchParams {
  if (typeof params.make !== "string" || !params.make.trim()) throw new TypeError("make is required");
  assertDimension(params.width, "width");
  assertDimension(params.height, "height");
  const search = new URLSearchParams({ make: params.make.trim() });
  for (const key of ["size", "fit", "background", "format"] as const) {
    if (params[key] !== undefined) search.set(key, String(params[key]));
  }
  if (params.width !== undefined) search.set("w", String(params.width));
  if (params.height !== undefined) search.set("h", String(params.height));
  if (params.trim !== undefined) search.set("trim", params.trim ? "1" : "0");
  if (params.padding !== undefined) search.set("padding", String(params.padding));
  return search;
}
