/**
 * Public types for the Car Image API (https://carimage.dev).
 *
 * Wire shapes mirror the REST contract documented at /openapi.json. Field
 * names on responses are snake_case exactly as the server sends them; method
 * options on the client are camelCase.
 */

import type { VehicleSuggestion } from "./errors.js";

export const DEFAULT_BASE_URL = "https://carimage.dev";

/**
 * The nine camera angles: eight in yaw order around the car, then `top`,
 * straight down from above with the nose up. `front-3-4` is the classic hero
 * shot; each angle that shows the car's left side has a `-right` twin that
 * shows its right side.
 */
export const VIEWS = [
  "front",
  "front-3-4",
  "side",
  "rear-3-4",
  "rear",
  "rear-3-4-right",
  "side-right",
  "front-3-4-right",
  "top",
] as const;
export type View = (typeof VIEWS)[number];

/**
 * The other spellings each view is accepted under, as the server documents
 * them (`GET /api/v1/images/options`). "Left" and "right" name the side of the
 * car the camera sees, which is also where the nose points in the frame.
 * Case and separators do not matter: `front_left` and `Front Left` read as
 * `front-left`. {@link parseView} resolves any of them.
 */
export const VIEW_ALIASES: Readonly<Record<View, readonly string[]>> = {
  front: [],
  "front-3-4": ["front34", "hero", "front-3-4-left", "front-left", "left-front"],
  side: ["side-left", "profile", "left", "left-side"],
  "rear-3-4": ["rear34", "rear-3-4-left", "rear-left", "left-rear", "back-left"],
  rear: ["back"],
  "rear-3-4-right": ["rear34-right", "rear-right", "right-rear", "back-right"],
  "side-right": ["side-r", "right", "right-side"],
  "front-3-4-right": ["front34-right", "front-right", "right-front"],
  top: ["top-down", "overhead", "birds-eye", "bird-eye", "aerial", "above", "plan"],
};

/**
 * The query parameters of an image URL (`GET /api/v1/images/car`,
 * `/images/car.png`) by their documented names, each with the other names the
 * server reads it under, in any case: `angle=rear` is `view=rear`, `paint=red`
 * is `color=red`, `bg=white` is `background=white`. The SDK always sends the
 * documented names; this is for code that writes or forwards image URLs
 * itself. A URL may also carry tracking tags and cache busters (`utm_*`,
 * `gclid`, `fbclid`, `ref`, `v`, `t`, `cb`, `_`…), which the server ignores and
 * names in `X-Ignored-Parameters`; any other name is a 400 whose problem names
 * it (`parameter`) and lists these keys (`allowed`), and nothing is charged.
 * JSON bodies take the documented names and their spellings (`width`,
 * `colour`, `vehicle_id`), never the synonyms.
 */
export const IMAGE_QUERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  make: ["brand"],
  model: [],
  year: [],
  vehicle: ["vehicle_id"],
  view: ["angle", "camera", "perspective", "orientation"],
  color: ["colour", "paint", "paint_color", "hex", "colors"],
  size: [],
  w: ["width"],
  h: ["height"],
  fit: [],
  background: ["bg", "background_color"],
  framing: [],
  aspect_ratio: ["aspect", "aspectratio"],
  resolution: [],
  trim: [],
  padding: [],
  shadow: [],
  format: [],
  market: [],
};

/** The fifteen preset paint colors. Any other paint is a hex color; see {@link Color}. */
export const COLORS = [
  "white",
  "black",
  "gray",
  "silver",
  "blue",
  "red",
  "green",
  "brown",
  "beige",
  "tan",
  "orange",
  "yellow",
  "gold",
  "burgundy",
  "purple",
] as const;
export type PresetColor = (typeof COLORS)[number];

/**
 * A paint color: one of the presets (`grey` is read as `gray`), any other CSS
 * color name (`navy`, `darkgreen`), or any hex as `#rrggbb`, `rrggbb`, `#rgb`
 * or `rgb` (the `string & Record<never, never>` keeps the preset names in
 * autocomplete). Query strings carry a hex bare (`color=1a2b3c`), JSON bodies
 * take either spelling, and responses echo any paint that is not a preset as
 * hex (`#000080` for navy).
 */
export type Color = PresetColor | (string & Record<never, never>);

/**
 * The 148 CSS named colors (CSS Color Module Level 4). The API reads them as
 * their CSS hex for `color` and `background`, except the fifteen preset names,
 * which keep their own paint swatches.
 */
export const CSS_COLOR_NAMES: readonly string[] = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue",
  "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon",
  "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
  "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick",
  "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
  "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo",
  "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue",
  "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen",
  "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue",
  "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
  "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid",
  "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen",
  "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose",
  "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
  "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown",
  "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato",
  "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
];

/** The hex spellings a `Color` accepts: three or six hex digits, `#` optional. */
export const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Square size presets in pixels; `size` is shorthand for `width`. */
export const SIZES = { thumb: 256, small: 512, medium: 768, large: 1024 } as const;
export type Size = keyof typeof SIZES;

/** The encodings an image is delivered in. */
export const FORMATS = ["png", "webp", "jpg"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * What a request may ask for: an encoding, or `auto`, which the server
 * negotiates per response from the `Accept` header (WebP for clients that
 * advertise it, PNG otherwise). Signed URLs keep `auto` and negotiate on load.
 */
export const REQUEST_FORMATS = [...FORMATS, "auto"] as const;
export type RequestFormat = (typeof REQUEST_FORMATS)[number];

/**
 * How the render is placed when both `width` and `height` are given:
 * `contain` (default) delivers exactly width×height with the whole car visible,
 * `cover` fills the box and crops at the centre, `inside` keeps the car within
 * the box and may deliver a smaller image. With one dimension every mode agrees.
 */
export const FITS = ["contain", "cover", "inside"] as const;
export type Fit = (typeof FITS)[number];

/** `padding` is a percentage of the longer side of the trimmed car, or of the stored frame without `trim`, at most this. */
export const MAX_PADDING_PERCENT = 50;

/**
 * Composition presets. `tight` and `balanced` are shorthand for `trim` and
 * `padding` that the server spells out before anything else reads the request
 * (same image, URL, cache entry and credit as the spelled-out form);
 * `consistent` (the default, no trim) keeps one apparent scale across a
 * vehicle's views, for galleries, 360 spinners and 3D previews; `tight` is
 * `trim: true, padding: 0`, the whole car filling the box; `balanced` is
 * `trim: true, padding: 6`, a catalog layout with even margins. Never send it
 * together with `trim` or `padding`.
 */
export const FRAMINGS = ["consistent", "tight", "balanced"] as const;
export type Framing = (typeof FRAMINGS)[number];

/**
 * What an idempotency key may look like, wherever it travels: the
 * `Idempotency-Key` header, the SDK's `idempotencyKey`, the MCP tool's
 * `idempotency_key`. 1-255 characters of letters, digits, ".", "_", ":" or
 * "-"; the server validates against this same pattern.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;

/**
 * `aspectRatio`: a preset for the box. `natural` is the car's own trimmed shape;
 * the others are a width×height box, the `resolution` you name or the largest,
 * delivered up to the stored image's own size. `width` and `height` together win.
 */
export const ASPECT_RATIOS = ["1:1", "4:3", "3:2", "16:9", "natural"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** `resolution`: a preset for the box's longer side, in pixels, delivered up to the stored image's own size. */
export const RESOLUTIONS = { small: 640, medium: 1280, hd: 1920, "2k": 2560 } as const;
export type Resolution = keyof typeof RESOLUTIONS;

/**
 * The longest side any image is stored at: new renders fill a canvas of up to
 * 2560 px, renders from before 2026-11 are 1024 px squares. The server clamps a
 * larger `width` or `height` to the stored image's own size rather than refusing it.
 */
export const MAX_DIMENSION = 2560;
export const MIN_YEAR = 1990;

/**
 * Headline catalog figures from `@meterapp/vehicle-db`, quoted in the MCP
 * instructions and tool descriptions agents read before choosing a tool:
 * what the API can render, the makes and models it addresses by name and the
 * model years it gives vehicle ids, counted the way the site's /cars pages
 * and sitemap list them.
 *
 * The SDK ships standalone with no runtime dependencies, so it cannot read the
 * database package to count these live. They are literals here and the server
 * repository holds the same figures in `app/_lib/site.ts`; its
 * `catalog-surface.test.ts` asserts the two agree and `site.test.ts` asserts
 * them against the bundled database, so a catalog upgrade fails the build
 * instead of quietly misstating what the API covers.
 */
export const CATALOG = {
  makes: 1_609,
  models: 42_365,
  modelYears: 197_337,
  yearFrom: MIN_YEAR,
  yearTo: 2027,
} as const;

/**
 * Credit figures. Since 2026-10-25 plans meter vehicle images (one vehicle in
 * one color from one angle, once a month, delivered as often as needed) and
 * images cost no credits; credits are no longer sold and pay only for 3D
 * models, make logos and quality upgrades.
 *
 * Legacy: `CREDITS_PER_IMAGE` (1) and `CREDITS_PER_DOLLAR` (100) describe the
 * credit meter that accounts which paid before 2026-10-25 keep until their
 * cutover (`plan.meter === "credits"`). `FREE_CREDITS` is the signup grant.
 */
export const CREDITS_PER_IMAGE = 1;
export const CREDITS_PER_DOLLAR = 100;
export const FREE_CREDITS = 100;

/**
 * The Free plan's vehicle images (each vehicle in each color and angle): one
 * allowance per account, not per month, since 2026-11-11. Once they run out the
 * account gets FREE_COURTESY_VEHICLE_IMAGES more, once.
 */
export const FREE_VEHICLE_IMAGES = 30;
/** Free's one-time courtesy, added when its FREE_VEHICLE_IMAGES run out. */
export const FREE_COURTESY_VEHICLE_IMAGES = 30;

/**
 * The self-serve plans since 2026-10-25, for help text and agents that
 * cannot fetch `GET /api/v1/pricing` (the live figures). A vehicle image is
 * one vehicle in one color from one angle, counted once a month (on Free,
 * once per account: `period: "lifetime"`, with a one-time courtesy) and
 * delivered as often as needed, whether the catalog has it ready or prepares
 * it first. No overage; credits (3D models, logos, upgrades) are not
 * sold. The server repository holds the definition (`lib/plans.ts`).
 */
export const PLAN_ALLOWANCES = {
  free: { monthlyUsd: 0, yearlyUsd: 0, vehicleImages: FREE_VEHICLE_IMAGES, period: "lifetime", courtesyImages: FREE_COURTESY_VEHICLE_IMAGES, creditsPerMonth: 0 },
  starter: { monthlyUsd: 29, yearlyUsd: 290, vehicleImages: 100, period: "month", courtesyImages: 0, creditsPerMonth: 100 },
  pro: { monthlyUsd: 49, yearlyUsd: 490, vehicleImages: 2_500, period: "month", courtesyImages: 0, creditsPerMonth: 1_000 },
  business: { monthlyUsd: 99, yearlyUsd: 990, vehicleImages: 10_000, period: "month", courtesyImages: 0, creditsPerMonth: 4_000 },
} as const;

/** A make logo costs this many credits per delivery, on every meter. */
export const CREDITS_PER_LOGO = 1;
/** A quality upgrade of one stored view costs this many credits. */
export const CREDITS_PER_UPGRADE = 20;

/** How an account's images are metered: per vehicle image (current plans), or one credit per delivery (accounts that paid before 2026-10-25, until their cutover). */
export type ImageMeter = "vehicle_images" | "credits";

/** A 3D model costs this many credits; `list3dModels()` reports the live figure. */
export const CREDITS_PER_3D_MODEL = 100;

export type Make = string;
/**
 * Model name or slug. The API accepts conservative typos, reviewed vehicle-db
 * aliases and BMW petrol badges with explicit bodies (430-gran-coupe).
 * A match must exist for the requested make/year; ambiguous names stay 404s.
 */
export type Model = string;
/** Model year, e.g. `2024` or `"2024"`. */
export type Year = number | string;

/**
 * The stable id of one catalog vehicle (make, model and year), such as
 * `veh_395yw8tn73ff8`. Every catalog response carries them, `client.vehicle(id)`
 * looks one up, and `vehicle` names the car wherever make, model and year do.
 */
export type VehicleId = string;
export const VEHICLE_ID_PATTERN = /^veh_[0-9a-hjkmnp-tv-z]{13}$/;

/**
 * The market of sale: an ISO 3166-1 alpha-2 country code such as `US`, `GB`,
 * `DE`, `AU` or `JP`, in any case (the server answers in upper case). It
 * matters when the same model year looks different in different markets.
 * Today every market gets the default appearance, and each answer says which
 * was served ({@link Appearance}). Optional everywhere; an account may keep a
 * default (`default_market` on {@link AccountResponse}), which an explicit
 * market always overrides. It is never part of what an image is: the same
 * vehicle, color and view with and without a market is the same image and
 * the same counted vehicle image.
 */
export type Market = string;
/** What the SDK checks before sending a market: two letters. The server checks the code is assigned. */
export const MARKET_PATTERN = /^[A-Za-z]{2}$/;

/** A request that may name the market of sale. */
export interface MarketOption {
  /** The market of sale, e.g. `AU`; see {@link Market}. Omit for the account default, or none. */
  market?: Market;
}

/**
 * Which appearance an answer is about. `market` is the market the request
 * was read under: its own, else the account default, else null. `scope` is
 * `default` when the model year's default appearance was served, which is
 * every answer today, and `market` once an appearance specific to that
 * market is served instead.
 */
export interface Appearance {
  market: Market | null;
  scope: "default" | "market";
}

/**
 * Which vehicle an image or 3D request is about: make, model and year, or the
 * vehicle's stable id. The two are exclusive; the server answers 400 to both.
 */
export type VehicleSelector =
  | { make: Make; model: Model; year: Year; vehicle?: undefined }
  | { vehicle: VehicleId; make?: undefined; model?: undefined; year?: undefined };

/** Everything about an image but the vehicle: camera, paint, size and delivery options. */
export interface ImageOptions {
  /** Defaults to `front-3-4`. {@link parseView} turns an alias such as `left` into the view. */
  view?: View;
  /** A preset name, a CSS color name or a hex paint such as `#1a2b3c`; defaults to `silver`. */
  color?: Color;
  /** Preset shorthand for `width`; ignored when `width`/`height` are given. */
  size?: Size;
  /**
   * Pixels, 1 or more; delivered up to the stored image's own size (1024 px
   * square for older renders, up to 2560 px for new ones). With `height` too,
   * the output canvas is exactly width×height (see `fit`). The server clamps a
   * larger size: a width×height box shrinks whole and keeps its shape (1920×1080
   * of a 1024 px render is delivered as 1024×576), and `ImageResult.width`
   * reports what was served.
   */
  width?: number;
  /** Pixels, 1 or more; delivered up to the stored image's own size (see `width`). */
  height?: number;
  /**
   * A preset for the box (see {@link ASPECT_RATIOS}): `1:1`, `4:3`, `3:2`,
   * `16:9`, or `natural`, the car's own trimmed shape. Alongside one of `width`
   * or `height` it completes the other; both together win. Not with `size`.
   */
  aspectRatio?: AspectRatio;
  /**
   * A preset for the box's longer side (see {@link RESOLUTIONS}): `small` 640,
   * `medium` 1280, `hd` 1920, `2k` 2560, delivered up to the stored image's own
   * size. `width` or `height` win. Not with `size`.
   */
  resolution?: Resolution;
  /** Placement inside a width×height box; defaults to `contain`. */
  fit?: Fit;
  /**
   * Solid background the image is flattened onto: `#rrggbb`, `rrggbb`, `#rgb`,
   * any CSS color name (`white`, `whitesmoke`) or `transparent`. Defaults to
   * transparent (JPEG: white).
   */
  background?: string;
  /**
   * A composition preset in place of `trim`/`padding` (see {@link FRAMINGS}):
   * `consistent` (no trim, one apparent scale across a vehicle's views),
   * `tight` (= `trim: true, padding: 0`) or `balanced` (= `trim: true, padding: 6`).
   * Not together with `trim` or `padding`.
   */
  framing?: Framing;
  /** Crop to the car's own bounds before sizing, so it fills the box. */
  trim?: boolean;
  /** Margin, 0–50 percent of the longer side of the trimmed car, or of the stored frame without `trim`. */
  padding?: number;
  /**
   * A soft ground shadow under the car, drawn from the render's own cut-out
   * at delivery: semi-transparent on a transparent image, grey on a
   * `background`. Same vehicle image, no extra count. Car images only, not make logos.
   */
  shadow?: boolean;
  /** Defaults to `png` (transparent background). `auto` negotiates WebP or PNG per client. */
  format?: RequestFormat;
}

/** One image request: `{ make, model, year }` or `{ vehicle }`, plus the options and, optionally, the market of sale. */
export type ImageParams = VehicleSelector & ImageOptions & MarketOption;

/** A catalog make logo: 1 credit per delivery; trademarks are not licensed. */
export type MakeLogoParams = { make: Make } & Omit<ImageOptions, "view" | "color" | "shadow" | "framing">;

/** JSON image object accepted by POST endpoints (`image-urls`, `feedback`). */
export interface ImageRequestBody {
  vehicle?: VehicleId;
  make?: string;
  model?: string;
  year?: number;
  view?: View;
  color?: Color;
  width?: number;
  height?: number;
  fit?: Fit;
  background?: string;
  framing?: Framing;
  aspect_ratio?: AspectRatio;
  resolution?: Resolution;
  trim?: boolean;
  padding?: number;
  shadow?: boolean;
  format?: RequestFormat;
  /** The market of sale ({@link Market}); read by `image-urls` and `images/availability`, refused by `feedback`. */
  market?: Market;
}

export type ImageSource = "cache" | "generated";

export interface ImageResult {
  bytes: Uint8Array;
  /** `image/png`, `image/webp` or `image/jpeg`. */
  contentType: string;
  width: number | null;
  height: number | null;
  /** `X-Credits-Charged`: 0 on the vehicle-image meter, 1 on the credit meter. */
  creditsCharged: number | null;
  /** `X-Credits-Remaining`: credit-meter accounts only; null on the vehicle-image meter. */
  creditsRemaining: number | null;
  /** The vehicle-image meter's month after this image (`X-Vehicle-Images-*`); null on the credit meter. */
  usage: ImageUsage | null;
  source: ImageSource | null;
  etag: string | null;
  requestId: string | null;
  /** The catalog vehicle served (`X-Vehicle-Id`), so a bytes response still names it; null from servers that predate it. */
  vehicleId: VehicleId | null;
  /** Which appearance was served (`X-Vehicle-Appearance`); null or absent from servers that predate it, and on a make logo. */
  appearance?: Appearance | null;
}

export interface VehicleDescriptor {
  /** Stable id of the catalog vehicle; null when the catalog cannot name one. */
  vehicle_id: VehicleId | null;
  make: string;
  model: string;
  year: number;
  view: View;
  /** A preset name, or a hex paint echoed as `#rrggbb`. */
  color: Color;
  width?: number;
  height?: number;
  /** Present when both dimensions were given. */
  fit?: Fit;
  /** `#rrggbb`, when a solid background was requested. */
  background?: string;
  trim?: boolean;
  padding?: number;
  /** Present (true) when a ground shadow was requested. */
  shadow?: boolean;
  format: RequestFormat;
}

/**
 * The next plan, offered once a Free account has used 80% of its month's
 * vehicle images: what is left, and the plan one step up with a Checkout link
 * a person opens (an agent never buys it). Absent below 80% and on paid plans.
 */
export interface NearLimitUpgrade {
  /** `reached`: the allowance is used up; images already received this month keep serving. */
  state: "near" | "reached";
  remaining: number;
  next_plan: { id: string; name: string; price: { monthly: number | null; yearly: number | null }; adds: string[]; checkout_url: string };
}

/** The month's vehicle images: `included` null means no cap. */
export interface MeterCount {
  used: number;
  included: number | null;
  /** From 80% of a Free month: the next plan and its Checkout link. */
  upgrade?: NearLimitUpgrade;
}

/** What the usage headers of an image say on the vehicle-image meter (`null` included = `unlimited`). */
export interface ImageUsage {
  vehicleImages: MeterCount;
}

/**
 * The billing member of an image or signed-URL answer. On the vehicle-image
 * meter `credits_charged` is 0 and `vehicle_images` says what the month has
 * used; on the credit meter (legacy) it carries `credits_remaining`.
 */
export interface BillingSummary {
  credits_charged: number;
  /** Credit meter only. */
  credits_remaining?: number;
  /** Vehicle-image meter only. */
  vehicle_images?: MeterCount;
}

export interface ImageUrlResponse {
  data: {
    url: string;
    expires_at: string;
    vehicle: VehicleDescriptor;
    /** Null when only the render can tell (a trimmed car without an exact box). */
    width: number | null;
    height: number | null;
    format: RequestFormat;
    /** Which appearance the URL serves; absent on servers that predate it. */
    appearance?: Appearance;
  };
  billing: BillingSummary;
  request_id: string;
}

export interface DeliveryUrl {
  id: string;
  url: string;
  expires_at: string;
  /** 0 = unlimited redemptions until expiry. */
  max_uses: number;
  /**
   * Set on auto-renewing URLs (`renew: true`): the URL keeps serving past
   * `expires_at`, renewing in each further window of `ttlSeconds` in which it
   * is loaded (no extra count on the vehicle-image meter; one credit per window
   * on the legacy credit meter), until this instant. Null for a classic URL.
   */
  renews_until: string | null;
  vehicle: VehicleDescriptor;
  /** Which appearance the URL serves, and the market it was made for; absent on URLs made before 2026-11-12. */
  appearance?: Appearance;
}

export interface CreateImageUrlsOptions {
  /** The market of sale for every image that names none of its own ({@link Market}). */
  market?: Market;
  /** 60–604800 seconds; server default 3600. */
  ttlSeconds?: number;
  /** 0 (default) = unlimited until expiry. */
  maxUses?: number;
  /**
   * Auto-renew past the TTL: the first load in each further window of
   * `ttlSeconds` renews the URL (free on the vehicle-image meter; one more
   * credit on the legacy credit meter). For email, CMS
   * pages and documents that outlive a TTL. Requires `maxUses` 0 (the default).
   */
  renew?: boolean;
  /** How long a renewable URL keeps renewing, 1–365 days from creation; server default 365. */
  renewDays?: number;
  /**
   * Sent as `Idempotency-Key`. A retry with the same key and body replays the
   * first response instead of minting and billing again. One is generated per
   * call when omitted, so the SDK's own retries are always safe; pass your own
   * to make retries across processes safe too.
   */
  idempotencyKey?: string;
}

export interface RenewalSummary {
  /** Length of each renewal window: the TTL. */
  window_seconds: number;
  /** Credit meter only: credits billed on the first load of each further window. */
  credits_per_window?: number;
  /** When renewals stop. */
  until: string;
}

export interface CreateImageUrlsResponse {
  data: DeliveryUrl[];
  billing: BillingSummary & { charged_on: "creation"; credits_per_url?: number; renewal?: RenewalSummary | null };
  request_id: string;
  /**
   * True when the server answered from the response it stored for this
   * `Idempotency-Key` (`Idempotent-Replayed: true`): the URLs are the ones
   * minted the first time and nothing was billed again.
   */
  idempotent_replayed?: boolean;
}

/** Free, read-only availability of one vehicle, optionally narrowed to a view and paint. */
export type ImageAvailabilityParams = VehicleSelector & { view?: View; color?: Color } & MarketOption;
export type ImageQuality = "standard" | "enhanced" | "premium";
export interface RenderEta {
  typical_seconds: number;
  slow_seconds: number;
  samples: number;
}
/** Why a stored view can be upgraded: it was drawn with an older paint generation, or below enhanced quality. */
export type ImageUpgradeReason = "paint_generation" | "quality";
export interface ImageViewAvailability {
  view: string;
  /** Prepared/cached: serves from storage without waiting for a new render. */
  cached: boolean;
  /**
   * Verified: the image served for this view was compared, at full size and
   * together with the vehicle's other views, with the manufacturer's own
   * material for that model year, and matched. A separate fact from `cached`;
   * `false` says only that this view has not been verified yet, as most have
   * not. A replaced image is checked again before it counts.
   */
  verified: boolean;
  quality: ImageQuality | null;
  /** The paint generation the stored view was drawn with (compare with `latest_paint_generation`); null when it is not stored. */
  paint_generation: number | null;
  /** An upgrade can redraw this view now with the latest paint generation at enhanced quality and store the new version. */
  upgradable: boolean;
  /** Why it is upgradable (`paint_generation` first when both apply); null when it is not. */
  upgrade_reason: ImageUpgradeReason | null;
  upgrade_in_progress: boolean;
  render_eta: RenderEta | null;
  upgrade_eta: RenderEta | null;
}
export interface ImageAvailabilityResponse {
  data: {
    object: "image_availability";
    vehicle: { id: VehicleId | null; make: string; model: string; year: number };
    color: Color;
    views: ImageViewAvailability[];
    /** `verified` counts the views answered with `verified: true`. */
    summary: { cached: number; verified: number; high_quality: number; upgradable: number };
    /** The paint generation new renders and upgrades are drawn with today. */
    latest_paint_generation: number;
    estimates: Record<string, RenderEta>;
    pricing?: { meter: string; image_credits: number; upgrade_credits: number };
    /** Which appearance these views are of; absent on servers that predate it. */
    appearance?: Appearance;
  };
  request_id: string;
}

/** One answer of {@link CarImageClient.checkAvailability}, in the order the images were sent. */
export interface AvailabilityCheckItem {
  index: number;
  /** The vehicle view is prepared: every color of it serves now, with no wait. */
  prepared: boolean;
  /** The prepared image is verified (see {@link ImageViewAvailability.verified}); `false` says only that it has not been verified yet. */
  verified: boolean;
  /** Asking for it now would count a vehicle image this month (not received yet this month). */
  counts_image: boolean;
  vehicle: { id: VehicleId; make: string; model: string; year: number };
  view: View;
  color: Color;
  /** Which appearance the answer is about; absent on servers that predate it. */
  appearance?: Appearance;
}

/** One allowance as an availability check sees it: what is used, the plan's figure (null: no cap), what the list would add and whether it fits. */
export interface AllowanceCheck {
  used: number;
  included: number | null;
  would_add: number;
  fits: boolean;
}

/** POST /api/v1/images/availability: free and read-only. */
export interface AvailabilityCheckResponse {
  data: {
    object: "image_availability_check";
    images: AvailabilityCheckItem[];
    summary: { items: number; prepared: number; not_prepared: number; verified: number };
    /** Null for an account on the legacy credit meter. */
    allowance: {
      period: { month_start: string };
      vehicle_images: AllowanceCheck;
    } | null;
  };
  request_id: string;
}

export interface ViewOption {
  id: View;
  label: string;
  yaw_degrees: number;
  /** 5 for the views around the car, 90 for `top` (straight down). */
  elevation_degrees: number;
  description: string;
  aliases: string[];
}

export interface ColorOption {
  name: PresetColor;
  hex: string;
}

export interface PricingInfo {
  /** 0 on the vehicle-image meter; 1 on the legacy credit meter. */
  credits_per_image: number;
  /** Legacy: credits are no longer sold. */
  credits_per_dollar?: number;
  free_credits: number;
}

/** @deprecated Credits are no longer sold (2026-10-25); servers answer `packs: []` or leave it out. */
export interface CreditPack {
  credits: number;
  cents: number;
  label?: string;
}

export type PlanCode = "free" | "starter" | "pro" | "business" | "enterprise";
/** `evaluation`: evaluation and personal projects (Free); `commercial`: commercial use inside your own products while subscribed, copies on your own servers and CDN included, deleted within 30 days after the plan ends; `commercial+export`: plus a bulk export or a catalog copy under a written agreement (Enterprise). */
export type PlanLicense = "evaluation" | "commercial" | "commercial+export";
export type PlanInterval = "month" | "year";

/**
 * One plan as `pricing.plans` lists it (on `options()` and `account()`):
 * prices in cents (null for Enterprise, which is custom), the monthly
 * vehicle images, the credits (for 3D models, logos and
 * upgrades), the license and the caps. `included_credits` is 0 on Free, whose
 * 100 credits are granted once at signup, and on Enterprise (negotiated); a
 * null allowance means negotiated or no cap.
 */
export interface PublicPlan {
  code: PlanCode;
  name: string;
  monthly_cents: number | null;
  yearly_cents: number | null;
  included_credits: number;
  license: PlanLicense;
  /** Distinct vehicle images (vehicle, color, angle) a month; on Free, per account (`image_period: lifetime`). */
  images_per_month?: number | null;
  /** `month`, or `lifetime` (Free since 2026-11-11). Absent on older servers. */
  image_period?: "month" | "lifetime";
  /** Images added once when a lifetime allowance runs out; 0 on monthly plans. Absent on older servers. */
  courtesy_images?: number;
  /** Legacy credit meter's distinct-vehicle cap. */
  vehicles_per_month: number | null;
  rate_limit_per_minute: number;
}

export type PlanStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused";

/** The plan in force for the account, as `GET /api/v1/account` reports it under `data.plan`. Free when there is no active subscription. */
export interface AccountPlanInfo {
  code: PlanCode;
  name: string;
  /** `active`, `trialing` and `past_due` keep the license and allowance in force. */
  status: PlanStatus;
  /** Whether the plan's license and allowance are in force right now. */
  active: boolean;
  /** `stripe` when the plan comes from a Stripe subscription (bought through Checkout); `manual` otherwise, as for a written agreement, a grandfathered plan or an account that never subscribed. */
  provider?: "stripe" | "manual";
  interval: PlanInterval | null;
  current_period_start?: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Credits (3D models, make logos, upgrades) granted at the start of every month of the plan; 0 on Free. */
  included_credits: number;
  allowance_granted_at: string | null;
  /** When what is left of the current allowance expires and the next one is granted. */
  allowance_period_end: string | null;
  license: PlanLicense;
  /** How images are metered: `vehicle_images` (current plans) or `credits` (paid before 2026-10-25, until the cutover). Absent on servers before 2026-10-25. */
  meter: ImageMeter;
  limits: {
    /** Distinct vehicle images (vehicle, color, angle) in the allowance period (`image_period`): a UTC calendar month, or on Free the account's whole life; null means no cap. */
    images_per_month: number | null;
    /** `month`, or `lifetime`: Free's images are one allowance per account since 2026-11-11. Absent on older servers. */
    image_period?: "month" | "lifetime";
    /** Images added once when a lifetime allowance runs out (Free's courtesy); 0 on monthly plans. Absent on older servers. */
    courtesy_images?: number;
    /** Per key, unless the key carries its own override (`key.rate_limit_per_minute`). */
    rate_limit_per_minute: number;
    /** Across every key and connected app of the account. */
    account_rate_limit_per_minute: number;
    /** Credit meter only: distinct (make, model, year) the account may pay for in a UTC calendar month; null means no cap. */
    vehicles_per_month: number | null;
    /** Distinct vehicles over the plan's current period (`current_period_start` to `current_period_end`), set only by a written Enterprise agreement; null means no term cap. */
    vehicles_per_term?: number | null;
    /** The share of the daily render budget the account's cold renders may use per UTC day. */
    generation_share_pct: number;
    max_keys: number;
  };
}

/** One output format. `png` and `webp` keep the cut-out's alpha; `jpg` does not; `auto` is negotiated. */
export interface FormatOption {
  id: RequestFormat;
  mime: string;
  transparent: boolean;
}

/** One `framing` preset as the options endpoint describes it, with the trim and padding it stands for. */
export interface FramingOption {
  id: Framing;
  description: string;
  trim: boolean;
  padding: number;
}

/** One `fit` mode as the options endpoint describes it. */
export interface FitOption {
  id: Fit;
  description: string;
}

/** One upstream registry behind the catalog, with the licence it ships under. */
export interface CatalogSource {
  id: string;
  name: string;
  region: string;
  license: string;
}

export interface OptionsResponse {
  data: {
    views: ViewOption[];
    /** The fifteen presets with their swatches; any other paint is a hex (`paint`). */
    colors: ColorOption[];
    /** How custom paint is spelled: any six-digit hex on the `color` parameter. */
    paint?: { parameter: string; custom: string; example: string };
    sizes: { presets: Record<Size, number>; max: number; source: number };
    fits?: FitOption[];
    default_fit?: Fit;
    framings?: FramingOption[];
    default_framing?: Framing;
    backgrounds?: { default: string; jpg_default: string; named: string[]; hex: string };
    trim?: { padding_max_percent: number };
    formats: FormatOption[];
    pricing: PricingInfo & { packs?: CreditPack[]; plans?: PublicPlan[] };
    catalog: { makes: number; models: number; years: { from: number; to: number }; sources: CatalogSource[] };
    /** Stable vehicle ids: what they look like, where to get one and the parameter that takes it. */
    vehicle_ids?: { description: string; example: string; lookup: string; parameter: string };
    limits: {
      rate_limit_per_minute_default: number;
      max_batch_urls: number;
      delivery_ttl: { default: number; min: number; max: number };
    };
    links: Record<string, string>;
  };
  request_id?: string;
}

export interface ResolvedParams {
  /** Stable id of the resolved catalog vehicle; `{ vehicle }` renders it again. */
  vehicle_id: VehicleId | null;
  make: string;
  model: string;
  year: number;
  view: View;
  color: Color;
}

export interface ResolveCandidate {
  make_name?: string;
  make_slug?: string;
  model_name?: string;
  model_slug?: string;
  years?: number[];
  match_kind?: string;
  [key: string]: unknown;
}

/** How sure the resolver is; ask the human before making an image on `low`. */
export type ResolveConfidence = "high" | "medium" | "low";

export interface ResolveResponse {
  data: {
    params: ResolvedParams & { size?: Size; width?: number; format?: Format };
    display?: { make_name: string; model_name: string };
    candidates: ResolveCandidate[];
    /** `high`, `medium` or `low`. */
    confidence: ResolveConfidence;
    image_path?: string;
    /**
     * What the phrase itself said, null where it said nothing. `year` is the
     * year asked for: when it differs from `params.year`, the catalog has no
     * such model in that year and the answer is another one.
     */
    extracted?: {
      year: number | null;
      color: string | null;
      view: View | null;
      size: Size | null;
      width: number | null;
      format: Format | null;
    };
    /** Which appearance the resolved vehicle is read as; absent on servers that predate it. */
    appearance?: Appearance;
    [key: string]: unknown;
  };
  request_id: string;
}

/** A contiguous run of model years, as the catalog endpoints compact them. */
export interface YearRange {
  year_from: number;
  year_to: number;
}

export interface VehicleYearsResponse {
  data: { years: number[] };
}

export interface VehicleMake {
  id: number;
  name: string;
  slug?: string;
}

export interface VehicleMakesResponse {
  data: { year: number; makes: VehicleMake[] };
}

export interface VehicleModel {
  name: string;
  slug: string;
  vehicle_type?: string;
  /** The vehicle id of this model in the listed year; absent when no year was given. */
  id?: VehicleId;
  [key: string]: unknown;
}

export interface VehicleModelsResponse {
  data: { year: number; make_id: number; models: VehicleModel[] };
}

/** `GET /api/v1/vehicles?make=<slug>[&year=]`: one make's models by slug. */
export interface VehicleMakeModelsResponse {
  data: { make: Required<VehicleMake>; year?: number; models: VehicleModel[] };
}

/** `GET /api/v1/vehicles?make=<slug>&model=<slug>`: one model's years, each with its vehicle id. */
export interface VehicleModelLookupResponse {
  data: {
    make: Required<VehicleMake>;
    model: { name: string; slug: string; vehicle_type: string };
    years: number[];
    year_ranges: YearRange[];
    vehicles: Array<{ year: number; id: VehicleId }>;
  };
}

export type VehiclesResponse = VehicleYearsResponse | VehicleMakesResponse | VehicleModelsResponse;

export interface VehicleSearchResult {
  kind: "make" | "model";
  /** Catalog-library spelling. */
  makeId?: number;
  makeName?: string;
  modelName?: string;
  matchKind?: string;
  vehicleType?: string;
  /** REST spelling. */
  make_id?: number;
  make_name?: string;
  make_slug?: string;
  model_name?: string;
  model_slug?: string;
  match_kind?: string;
  vehicle_type?: string;
  years: number[];
  year_ranges?: YearRange[];
  /** The vehicle id for the one year the query named (in the text or `year`), when the model has it. */
  id?: VehicleId;
  /** On a model hit: `{ "<year>": "veh_…" }` for every year it is offered. */
  ids?: Record<string, VehicleId>;
  [key: string]: unknown;
}

export interface VehicleSearchResponse {
  data: { query?: string; year?: number; results: VehicleSearchResult[] };
}

/** `GET /api/v1/vehicles/{id}`: the vehicle a stable id names, and the URLs that render it. */
export interface VehicleResponse {
  data: {
    id: VehicleId;
    make: { id: number; name: string; slug: string };
    model: { name: string; slug: string; vehicle_type: string };
    year: number;
    /** Every model year of this model, and the same as ranges. */
    years: number[];
    year_ranges: YearRange[];
    /** `/api/v1/images/car?vehicle=<id>` (default view) and one path per camera. */
    image_path: string;
    images: Record<View, string>;
  };
  request_id: string;
}

// ------------------------------------------------------- coverage check

/** The most entries one `POST /api/v1/vehicles/check` reads; `client.checkVehicles` splits a longer list. */
export const MAX_CHECK_VEHICLES = 2_000;
/** The most entries one check reads with `views` (each match then reads its nine views); `client.checkVehicles` sends 100 a request then. */
export const MAX_CHECK_VIEWS_VEHICLES = 100;

/** How the catalog answered one entry of a coverage check. */
export const CHECK_STATUSES = ["match", "suggestion", "miss", "invalid"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/**
 * One vehicle to check: make, model and year as your data spells them, or a
 * stored vehicle id, plus `ref` (your own row id or SKU) echoed back with its
 * answer. Loose on purpose, like the rows of a file: an entry that names no
 * vehicle is answered `invalid` on its own. Other fields, such as the `view`
 * and `color` of an image request, are ignored, so the objects you would
 * render can be checked as they are.
 */
export interface VehicleCheckEntry {
  /** A stored vehicle id to confirm; send it without make, model and year. */
  vehicle?: VehicleId;
  make?: Make;
  model?: Model | number;
  year?: Year;
  ref?: string | number;
  /** The entry's own market of sale, when it differs from the list's ({@link Market}). A value that is not a country code is ignored, like any other column of yours. */
  market?: Market;
  [field: string]: unknown;
}

/** The rule that read a make and model, as `X-Vehicle-Match` reports it on a render (`/docs/vehicles#matching`). */
export type VehicleMatchKind = "exact" | "prefix" | "separator" | "family" | "words" | "alias" | "trim" | "badge" | "fuzzy";

/** The catalog vehicle a matched entry names: store `id` and render by it. */
export interface CheckedVehicle {
  id: VehicleId;
  /** Catalog make slug. */
  make: string;
  make_name: string;
  /** Catalog model slug. */
  model: string;
  model_name: string;
  year: number;
  /** `exact` for a catalog spelling or an id; otherwise the rule that read your name. */
  match: VehicleMatchKind;
  /** `/api/v1/images/car?vehicle=<id>`. */
  image_path: string;
}

/** POST /api/v1/requests for a vehicle a check missed, in the entry's own spelling. */
export interface VehicleCheckRequest {
  method: "POST";
  path: "/api/v1/requests";
  scope: "account:read";
  body: { kind: "vehicle"; make: string; model: string; year?: number; market?: Market };
}

export interface VehicleCheckResult {
  /** Position in the list you sent (across every request `checkVehicles` made). */
  index: number;
  /** The entry's `ref`, when it had one. */
  ref?: string | number;
  /**
   * `match`: a render of the entry serves `vehicle`. `suggestion`: it would
   * 404, and `suggestions` are real vehicles close to it (another year, a
   * related model), never the same car. `miss`: nothing close; skip the
   * vehicle in every view and color. `invalid`: the entry cannot be read (`error`).
   */
  status: CheckStatus;
  vehicle: CheckedVehicle | null;
  /** For a suggestion or a miss, what the catalog lacks: the make, the model, only the year, or the id. */
  reason?: "make" | "model" | "year" | "vehicle";
  suggestions?: VehicleSuggestion[];
  /** For a miss: `GET /api/v1/vehicles?q=…`, the catalog search to try by hand. */
  search?: string;
  /**
   * For a miss named by make, model and year: the vehicle request that asks
   * us to add it, ready to send (`client.createRequest(request.body)`); we
   * email you when it is added. Needs a key with `account:read`.
   */
  request?: VehicleCheckRequest;
  /** For an invalid entry: what is wrong with it. */
  error?: string;
  /** For a match, when the check asked for `views`: which of the vehicle's nine views are prepared. */
  views?: CheckedViews;
  /** For an entry whose own `market` is a country code: the appearance its answer is about. Every other entry is read under the check's. */
  appearance?: Appearance;
}

/**
 * Which of a matched vehicle's nine views are prepared, as
 * `GET /api/v1/images/availability?vehicle=<id>` answers (`cached`) when no color is sent.
 */
export interface CheckedViews {
  /** Views prepared now, 0 to 9: each answers at once, with no render to wait for. */
  prepared: number;
  /** The views not prepared yet, in `VIEWS` order: a request for one waits while it is prepared. */
  missing: View[];
  /**
   * The prepared views that are verified, in `VIEWS` order (see
   * {@link ImageViewAvailability.verified}). A prepared view not listed here
   * has not been verified yet, which says nothing else about it.
   */
  verified: View[];
}

export interface VehicleCheckSummary {
  total: number;
  match: number;
  suggestion: number;
  miss: number;
  invalid: number;
  /** Distinct vehicle ids among the matches: what a backfill counts against a plan's distinct vehicles a month. */
  distinct_vehicles: number;
  /** With `views`: distinct matched vehicles whose nine views are all prepared. */
  views_complete?: number;
  /** With `views`: distinct matched vehicles with at least one prepared view whose every prepared view is verified. */
  views_verified?: number;
}

/** `POST /api/v1/vehicles/check`: every entry's answer, in order, and the counts. */
export interface VehicleCheckResponse {
  data: {
    /** The appearance the list was read under: the check's market, else the account default; absent on servers that predate it. */
    appearance?: Appearance;
    summary: VehicleCheckSummary;
    results: VehicleCheckResult[];
  };
  /** The last request's id when `checkVehicles` split the list. */
  request_id: string;
}

export type FeedbackTarget = { requestId: string } | (VehicleSelector & { view?: View; color?: Color });

export type FeedbackInput = FeedbackTarget & {
  rating?: 1 | 2 | 3 | 4 | 5;
  verdict?: "good" | "bad";
  reason?: string;
};

export interface FeedbackResponse {
  data: {
    asset_id?: string | null;
    recorded?: boolean;
    flagged?: boolean;
    /**
     * A negative rating files an image report ({@link CarImageClient.reportImage}):
     * its id, its private page, its status and whether it is new. Null for a
     * positive rating; absent from servers that predate image reports.
     */
    id?: string | null;
    url?: string | null;
    status?: ImageReportStatus | null;
    created?: boolean | null;
    report?: ImageReport | null;
    [key: string]: unknown;
  };
  request_id: string;
}

// ------------------------------------------------------------ image reports

/** What an image report is about: the wrong car, angle or paint; a poor render; or a vehicle the catalog lacks. */
export const IMAGE_REPORT_TYPES = ["wrong_image", "poor_quality", "missing_vehicle"] as const;
export type ImageReportType = (typeof IMAGE_REPORT_TYPES)[number];

/** `identity`, `camera` and `paint` are a `wrong_image`'s (default `identity`); `quality` is a `poor_quality`'s. A missing vehicle has none. */
export const IMAGE_REPORT_CATEGORIES = ["identity", "camera", "paint", "quality"] as const;
export type ImageReportCategory = (typeof IMAGE_REPORT_CATEGORIES)[number];

/**
 * `reported`: recorded, the image keeps serving. `flagged`: enough accounts
 * reported the image and it is out of service while it is fixed (image
 * reports only). `repaired`: a fix is serving (a missing vehicle joined the
 * catalog). `closed`: the team closed it without a repair.
 */
export const IMAGE_REPORT_STATUSES = ["reported", "flagged", "repaired", "closed"] as const;
export type ImageReportStatus = (typeof IMAGE_REPORT_STATUSES)[number];

/** Longest `reason` and `external_ref` the server takes. */
export const IMAGE_REPORT_REASON_MAX_LENGTH = 500;
export const IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH = 100;

interface ImageReportCommon {
  /** What was wrong, in the reporter's words (at most 500 characters). No personal data. */
  reason?: string;
  /** Your own id for the report, such as the ticket in your app (at most 100 characters); returned on the report and in its webhooks. */
  externalRef?: string;
}

/** The stored image a report is about: by asset id, by the request id that delivered it, or by vehicle with view and color. */
export type ImageReportTarget =
  | { assetId: string; requestId?: undefined }
  | { requestId: string; assetId?: undefined }
  | (VehicleSelector & { view?: View; color?: Color; assetId?: undefined; requestId?: undefined });

/** A wrong or poor image. `type` defaults to `poor_quality` for category `quality`, else `wrong_image`. */
export type ImageReportImageInput = ImageReportCommon &
  ImageReportTarget & {
    type?: "wrong_image" | "poor_quality";
    category?: ImageReportCategory;
  };

/** A vehicle the catalog does not carry: make, model and year only, as the human typed them. */
export interface ImageReportMissingVehicleInput extends ImageReportCommon {
  type: "missing_vehicle";
  make: string;
  model: string;
  year: Year;
}

/** `POST /api/v1/images/reports`. */
export type ImageReportInput = ImageReportImageInput | ImageReportMissingVehicleInput;

/** A tracked image report. `url` is its page, private to the reporting account and the Car Image team. */
export interface ImageReport {
  object: "image_report";
  id: string;
  url: string;
  type: ImageReportType;
  status: ImageReportStatus;
  /** `status` is `flagged`. */
  flagged: boolean;
  category: ImageReportCategory | null;
  /** Null for a missing vehicle. */
  asset_id: string | null;
  vehicle: { make: string; model: string; year: number };
  view?: string | null;
  color?: string | null;
  reason?: string | null;
  external_ref?: string | null;
  /** Reports this account folded into this one. */
  report_count: number;
  created_at: string;
  last_reported_at?: string;
  resolved_at?: string | null;
  resolution?: "repaired" | "closed" | null;
}

/**
 * `POST /api/v1/images/reports` (201 `created: true` for a new report, 200
 * `created: false` when it folded into the account's open one) and
 * `GET /api/v1/images/reports/{id}`.
 */
export interface ImageReportResponse {
  data: ImageReport;
  created?: boolean;
  request_id: string;
}

// ------------------------------------------------------------------ VIN

/** Which decoder answered: the vPIC database, or NHTSA's API when it could not. */
export type VinSource = "vpic-db" | "vpic-api";

/** One NHTSA decoder diagnostic (code 0, "decoded clean", is never listed). */
export interface VinError {
  code: number;
  text: string;
}

/**
 * `GET /api/v1/vin/{vin}`: a decoded VIN. Every key is present; unknown values
 * are null. `vehicle` is the catalog vehicle the VIN maps to, with the id and
 * image path that render it, or null when the catalog does not carry it.
 */
export interface VinResult {
  /** The VIN as decoded: uppercased, spaces and dashes removed. */
  vin: string;
  /** False when the decoder reported a problem (see `errors`, `suggested_vin`). */
  valid: boolean;
  errors: VinError[];
  suggested_vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  body_class: string | null;
  vehicle_type: string | null;
  doors: number | null;
  drive_type: string | null;
  fuel_type: string | null;
  engine: { cylinders: number | null; displacement_l: number | null; hp: number | null; model: string | null };
  transmission: { style: string | null; speeds: number | null };
  manufacturer: string | null;
  plant: { city: string | null; state: string | null; country: string | null };
  gvwr: string | null;
  /** Every decoded vPIC variable verbatim (minus the diagnostics above). */
  attributes: Record<string, string>;
  vehicle: { id: VehicleId; make: string; model: string; year: number; image_path: string } | null;
  source: VinSource;
}

export interface VinResponse {
  data: VinResult;
  request_id: string;
}

export interface DecodeVinOptions {
  /** Model-year hint for the decoder; flags a mismatch with the VIN's own year position. */
  year?: Year;
}

// ------------------------------------------------------------- 3D models

/**
 * The files a ready model offers; `glb_web` is the GLB rebuilt for browsers
 * (meshopt compression and WebP textures); `paint_mask` is a grayscale PNG the
 * size of the GLB's base-colour texture, white where the texel is paint, for
 * recolouring the paint live in your own viewer.
 */
export const MODEL_3D_FILE_KINDS = ["glb", "glb_web", "usdz", "fbx", "thumbnail", "paint_mask"] as const;
export type Model3dFileKind = (typeof MODEL_3D_FILE_KINDS)[number];

export type Model3dStatus = "queued" | "processing" | "ready" | "failed";

/** One downloadable file; `url` is an API URL that redirects to a short-lived signed object. */
export interface Model3dFile {
  url: string;
  bytes: number;
  content_type: string;
}

/** The copies a published model serves without a key: the web GLB, the USDZ and the transparent poster. */
export const MODEL_3D_PUBLIC_FILE_KINDS = ["glb", "usdz", "poster"] as const;
export type Model3dPublicFileKind = (typeof MODEL_3D_PUBLIC_FILE_KINDS)[number];

/** One key-free file of a published model: a stable URL that redirects to the CDN. */
export interface Model3dPublicFile {
  url: string;
  bytes: number;
  content_type: string;
}

/**
 * The hosted side of a published request (`publish3dModel`, or `publish: true`
 * on creation): key-free URLs any page may load, and the two-line embed.
 */
export interface Model3dPublic {
  /** The public id, `m3d_…`; the URLs and the embed carry it. */
  id: string;
  /** `GET /api/v1/3d/public/{id}`: the model as a viewer sees it, no key. */
  url: string;
  /** Null until the model is ready and its copies were made; the URLs are stable either way. */
  files: ({ glb: Model3dPublicFile } & Partial<Record<Model3dPublicFileKind, Model3dPublicFile>>) | null;
  embed: {
    /** The embed script (`/embed/3d.js`), once per page. */
    script: string;
    /** `<script …></script>` and `<car-3d model="m3d_…"></car-3d>`: paste into any HTML. */
    html: string;
  };
  published_at: string;
}

/** What `GET /api/v1/3d/public/{id}` answers: enough for a viewer, nothing about the account. */
export interface Model3dPublicView {
  id: string;
  object: "3d_model_public";
  status: Model3dStatus;
  progress: number;
  estimated_seconds_remaining: number | null;
  vehicle: { id: VehicleId | null; make: string; model: string; year: number; name: string };
  color: Color;
  /** The paint as `#rrggbb`. */
  color_hex: string;
  /** Camera theta in degrees where the front faces the viewer (0 now, -90 on older models). */
  front_theta: number;
  /** The alt text the embed uses when the page gives none. */
  alt: string;
  files: ({ glb: Model3dPublicFile } & Partial<Record<Model3dPublicFileKind, Model3dPublicFile>>) | null;
  embed: { script: string; html: string; model_viewer: string };
  published_at: string;
  updated_at: string;
}

/** Why a 3D request failed, whether it was refunded and how to retry. */
export interface Model3dError {
  code: string;
  message: string;
  /** The image request (`GET /api/v1/images/car`) for the same vehicle and color to make instead. */
  image_url?: string;
  /** True when nothing remains charged: the credits were refunded, or the order was free (already owned). False while a refund is pending. */
  refunded?: boolean;
  /** Credits given back for this order: what it was charged once refunded, else 0. */
  credits_refunded?: number;
  /** When the refund was posted; null while pending or for a free order. */
  refunded_at?: string | null;
  /** Always true: a failed order can be placed again. */
  retryable?: boolean;
  /** One sentence: the refund state and how to retry (a new Idempotency-Key or none; reusing this order's key replays it). */
  retry?: string;
}

/** A 3D request as `POST /api/v1/3d`, `GET /api/v1/3d/{id}` and the list return it. */
export interface Model3d {
  /** The caller's request id; the shared model behind it is never exposed. */
  id: string;
  object: "3d_model";
  status: Model3dStatus;
  /** 0–100. */
  progress: number;
  /** `views`, `geometry`, `texture`, `download`, `done`, or null before work starts. */
  stage: string | null;
  vehicle: { id: VehicleId | null; make: string; model: string; year: number };
  /** A preset name, or a hex paint echoed as `#rrggbb`. */
  color: Color;
  generator: string;
  /** Present once `status` is `ready`. */
  files: Partial<Record<Model3dFileKind, Model3dFile>> | null;
  polycount: number | null;
  /** Set when `status` is `failed`: what went wrong, whether the credits came back and how to order again. */
  error: Model3dError | null;
  estimated_seconds_remaining: number | null;
  webhook: { url: string; status: string | null; attempts: number; last_status: number | null; delivered_at: string | null } | null;
  /** The key-free URLs and embed once published; null until then. */
  public: Model3dPublic | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
}

export interface Model3dResponse {
  data: Model3d;
  request_id: string;
}

/**
 * `POST /api/v1/3d`: 202 while the model is being made, 200 when it was
 * already ready. `already_owned` is true, and `credits_charged` 0, when the
 * account already held a live request for this vehicle in this color.
 */
export interface CreateModel3dResponse {
  data: Model3d;
  /** A 3D model is paid in credits on every meter, so the balance is always there. */
  billing: { credits_charged: number; credits_remaining: number; charged_on: "creation"; already_owned: boolean };
  request_id: string;
}

export interface Model3dListResponse {
  data: Model3d[];
  pricing: { credits_per_model: number };
  request_id: string;
}

export interface CreateModel3dOptions {
  /** A preset name or a hex paint such as `#1a2b3c`; defaults to `silver`. */
  color?: Color;
  /** Public https URL that receives one POST when the model is ready or failed. */
  webhookUrl?: string;
  /** With `webhookUrl`: the body is signed as `X-CarImage-Signature: sha256=<hex HMAC>`. */
  webhookSecret?: string;
  /** Publish at once: `data.public` carries key-free URLs and the embed, files following when the model is ready. */
  publish?: boolean;
  /** Sent as `Idempotency-Key`; generated per call when omitted (see `CreateImageUrlsOptions`). */
  idempotencyKey?: string;
}

export interface WaitModel3dOptions {
  /** Time between polls; default 5000 ms. */
  intervalMs?: number;
  /** Give up after this long; default 1800000 ms (30 minutes). */
  timeoutMs?: number;
  /** Called after every poll with the current state. */
  onProgress?: (model: Model3d) => void;
  signal?: AbortSignal;
}

/** The bytes of one model file, fetched through the signed storage redirect. */
export interface Model3dFileResult {
  kind: Model3dFileKind;
  bytes: Uint8Array;
  /** `model/gltf-binary`, `model/vnd.usdz+zip`, `application/octet-stream` (FBX) or `image/png`. */
  contentType: string;
  requestId: string | null;
}

// ------------------------------------------------------------ requests

/** A feedback board entry: a missing vehicle, a feature idea or an issue report (private until the team publishes it). */
export type RequestKind = "vehicle" | "feature" | "issue";
export const REQUEST_KINDS = ["vehicle", "feature", "issue"] as const;

export type RequestStatus = "open" | "planned" | "in_progress" | "done" | "declined" | "duplicate";
export const REQUEST_STATUSES = ["open", "planned", "in_progress", "done", "declined", "duplicate"] as const;

/** `top` (most votes), `new` (newest) or `recent_activity` (latest vote, comment or change). */
export type RequestSort = "top" | "new" | "recent_activity";
export const REQUEST_SORTS = ["top", "new", "recent_activity"] as const;

export interface RequestRecord {
  id: string;
  kind: RequestKind;
  title: string;
  body: string | null;
  vehicle: { make: string; model: string; year: number | null } | null;
  status: RequestStatus;
  /** Issues are private (reporter and staff) until published. */
  visibility?: "public" | "private";
  /** Set when status is `duplicate`: the item votes and followers moved to. */
  duplicate_of?: string | null;
  /** The public issue, PR or page that tracks or shipped it. */
  external_ref?: string | null;
  closed_at?: string | null;
  votes: number;
  comments: number;
  /** Display name of the requester, never an email. */
  author: string;
  /** Public page for the request (already tagged for attribution). */
  url: string;
  created_at: string;
  updated_at: string;
  /** Only present on authenticated calls. */
  viewer?: { voted: boolean; author?: boolean };
}

export interface RequestComment {
  id: string;
  request_id: string;
  body: string;
  author: string;
  /** A response from the Car Image team. */
  official?: boolean;
  created_at: string;
}

/** One entry of an item's history: a status change, an official response or a link. */
export interface FeedbackTimelineEvent {
  at: string;
  type: "status" | "response" | "linked";
  from?: RequestStatus | null;
  to?: RequestStatus;
  note?: string | null;
  duplicate_of?: string | null;
  comment_id?: string;
  external_ref?: string;
}

/**
 * A request with its comment thread, as returned by `getRequest`. Here
 * `comments` is the thread and the count travels as `comment_count`.
 */
export type RequestDetail = Omit<RequestRecord, "comments"> & {
  comment_count: number;
  comments: RequestComment[];
  timeline?: FeedbackTimelineEvent[];
  /** An issue's captured context: only for its reporter and staff. */
  context?: Record<string, unknown> | null;
};

export type CreateRequestInput =
  | {
      kind: "vehicle";
      make: string;
      model: string;
      /** Model year; omit when any year would do. */
      year?: number | string;
      /** Why you need it, or which body style. */
      body?: string;
      /** The market of sale the request is about ({@link Market}). */
      market?: Market;
    }
  | {
      kind: "feature";
      title: string;
      body?: string;
    };

export interface ListRequestsParams {
  kind?: RequestKind;
  status?: RequestStatus;
  /** `top` (most votes first, default), `new` or `recent_activity`. */
  sort?: RequestSort;
  limit?: number;
  cursor?: string;
  /** Search titles and bodies. */
  q?: string;
  /** Your own items (private issues included) and the ones you follow; needs a key. */
  mine?: boolean;
}

/** The identifiers an issue report carries; the API checks they are yours and never shows them publicly. */
export interface IssueContext {
  /** X-Request-Id of the call that went wrong. */
  request_id?: string;
  endpoint?: string;
  method?: string;
  status?: number | string;
  error_code?: string;
  asset_id?: string;
  /** A vehicle id (`veh_…`). */
  vehicle?: string;
  view?: string;
  color?: string;
  make?: string;
  model?: string;
  year?: number | string;
  model_3d_id?: string;
  client?: string;
  client_version?: string;
  /** Anything else, as a JSON object. */
  details?: Record<string, unknown>;
}

export interface RequestFeatureInput {
  title: string;
  body?: string;
  /** File it even when similar items exist. */
  force?: boolean;
}

export interface ReportIssueInput extends RequestFeatureInput {
  /** Shorthand for `context.request_id`. */
  requestId?: string;
  context?: IssueContext;
  /** Attach the last failed request this client made (its id, endpoint and error code) when no request id is given. Default true. */
  attachLastError?: boolean;
}

/**
 * `POST /api/v1/feedback/features` and `/issues`: 201 `created: true` with the
 * new item, or 200 `created: false`, `data: null` and the `similar` items to
 * upvote instead (send `force: true` to file anyway).
 */
export interface FiledFeedbackResponse {
  created: boolean;
  data: RequestRecord | null;
  similar: RequestRecord[];
  request_id: string;
}

export interface ReviewInput {
  /** 1 to 5. */
  rating: number;
  title?: string;
  body?: string;
  likes?: string;
  dislikes?: string;
  use_case?: string;
  /** Shown with the review; defaults to your first name. */
  display_name?: string;
  display_company?: string;
  /** May Car Image quote it in marketing. Default false. */
  marketing_consent?: boolean;
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  likes: string | null;
  dislikes: string | null;
  use_case: string | null;
  display_name: string;
  display_company: string | null;
  created_at: string;
  updated_at: string;
  /** The team's response. */
  response: { body: string; responded_at: string } | null;
}

export interface OwnReview extends PublicReview {
  /** `published`, `pending` (held for a quick check) or `hidden`. */
  status: "published" | "hidden" | "pending";
  status_reason: string | null;
  marketing_consent: boolean;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface ReviewListResponse {
  data: PublicReview[];
  summary: ReviewSummary;
  next_cursor: string | null;
  request_id: string;
}

export interface ReviewResponse {
  data: OwnReview | null;
  /** On `PUT /api/v1/reviews/me`: true the first time. */
  created?: boolean;
  request_id: string;
}

export interface ListReviewsParams {
  sort?: "newest" | "highest" | "lowest";
  rating?: number;
  limit?: number;
  cursor?: string;
}

export interface RequestListResponse {
  data: RequestRecord[];
  next_cursor: string | null;
  request_id: string;
}

export interface RequestResponse {
  data: RequestRecord;
  request_id: string;
}

export interface RequestDetailResponse {
  data: RequestDetail;
  request_id: string;
}

/** `POST /api/v1/requests`: 201 with `deduplicated: false`, or 200 with `deduplicated: true`. */
export interface CreateRequestResponse extends RequestResponse {
  /** True when an identical open vehicle request already existed and received your vote instead. */
  deduplicated: boolean;
}

export interface RequestCommentsResponse {
  data: RequestComment[];
  request_id: string;
}

export interface RequestCommentResponse {
  data: RequestComment;
  request_id: string;
}

// ------------------------------------------------------------- about you

/** Where a customer first heard about the API. Only the Car Image team sees the answer. */
export const REFERRAL_SOURCES = [
  "search",
  "ai_assistant",
  "github",
  "npm",
  "twitter_x",
  "linkedin",
  "reddit",
  "hacker_news",
  "youtube",
  "friend_or_colleague",
  "blog_or_article",
  "other",
] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export interface BuildingResponse {
  data: { building: string; updated_at: string };
  request_id: string;
}

export interface ReferralResponse {
  data: { source: ReferralSource; detail: string | null; updated_at: string };
  request_id: string;
}

/** Roles in an organization, lowest first (docs: /docs/organizations). */
export type OrgRole = "viewer" | "member" | "admin" | "owner";

/**
 * The organization a credential acts for: the account whose credits, plan and
 * keys it uses. A person's personal organization is their own account.
 */
export interface AccountOrganization {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
  /** The caller's role: the key's creator, or the connected app's user; null when that person has left (the key still works). */
  role: OrgRole | null;
}

/** The Terms that govern an account's deliveries ({@link AccountResponse} `data.terms`). */
export interface AccountTerms {
  version: "2026-10-12" | "2026-10-25";
  /** True while the account keeps the 2026-10-12 terms it paid for before 2026-10-25. */
  legacy: boolean;
  /** ISO 8601 cutover to the 2026-10-25 terms for a legacy account; null when none is scheduled or not legacy. */
  cutover_at: string | null;
  /** What happens to the license when a paid plan ends, quoted from those Terms. */
  after_plan: string;
  /** `/terms#license`. */
  url: string;
}

/** `GET /api/v1/account/members` and the `list_members` tool: who is in the organization, read only. */
export interface AccountMembers {
  organization: AccountOrganization;
  members: Array<{ name: string | null; email: string | null; role: OrgRole; joined_at: string }>;
  teams: Array<{
    slug: string;
    name: string;
    description: string | null;
    members: Array<{ name: string | null; email: string | null; role: "member" | "maintainer" }>;
  }>;
}

export interface MembersResponse {
  data: AccountMembers;
  request_id: string;
}

export interface AccountResponse {
  data: {
    /** The organization this credential acts for, with the caller's role; absent on servers before organizations. */
    organization?: AccountOrganization;
    credits: number;
    auto_reload: boolean;
    has_payment_method: boolean;
    /** The plan in force; absent on servers that predate plans. */
    plan?: AccountPlanInfo;
    /**
     * The account's default market of sale ({@link Market}), which a request
     * that names none is read under; null for none. Set on the dashboard's
     * organization page. Absent on servers that predate it.
     */
    default_market?: Market | null;
    /**
     * Which version of the Terms governs what this account is delivered now:
     * accounts that paid before 2026-10-25 keep the version of 2026-10-12
     * until the cutover date in their notice (`cutover_at`, null while none is
     * scheduled); every other account is on 2026-10-25. `after_plan` quotes
     * what the license does when a paid plan ends. Absent on servers before 2026-11-17.
     */
    terms?: AccountTerms;
    pricing: PricingInfo & { packs?: CreditPack[]; plans?: PublicPlan[] };
    usage_30d?: { requests: number; images: number; cache_hit_rate: number };
    /** Usage against every limit the plan sets this period; absent on servers before 2026-10-17. */
    limits_usage?: {
      period: { month_start: string; resets_at: string };
      /** Which meter the counts below follow; absent on servers before 2026-10-25. */
      meter?: ImageMeter;
      /** Vehicle-image meter: distinct vehicle images this month; null on the credit meter. On Free its `limit` is null: read `vehicle_images_total`. */
      vehicle_images_this_month?: LimitUsage | null;
      /** Free (one allowance per account, since 2026-11-11): every vehicle image so far against the free images, plus the one-time courtesy once it was granted (`courtesy_images`). */
      vehicle_images_total?: (LimitUsage & { courtesy_images: number }) | null;
      /** Credit meter: distinct vehicles this month; null on the vehicle-image meter. */
      distinct_vehicles_this_month: LimitUsage | null;
      api_keys: LimitUsage;
      requests_per_minute_per_key: number;
      requests_per_minute_per_account: number;
    };
    /** When the paid plan renews; null on Free or a plan set to cancel. */
    renews_at?: string | null;
    /** The next plan up, what it adds, and a Checkout link that signs the human in first; null on Enterprise. */
    next_plan?: { id: PlanCode; name: string; price: { monthly: number | null; yearly: number | null }; adds: string[]; checkout_url: string } | null;
    key?: { prefix?: string; scopes: string[] };
  };
  links?: Record<string, string>;
  request_id: string;
}

/** One limit: what the account used of it; `limit` and `remaining` are null where the plan has no cap. */
export interface LimitUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** @deprecated The answer to a credit-pack Checkout; credits are no longer sold (the server answers 409 `subscription_required_for_credits`). */
export interface CheckoutResponse {
  data: { url: string; credits: number; amount_cents: number };
  request_id?: string;
}

/**
 * `POST /api/v1/billing/checkout` with a plan: a hosted Stripe Checkout URL for
 * a Free account (201), or, for an account already on a Stripe plan, the plan
 * switched in place (200, `url: null`, `changed: true`; Stripe invoices the
 * difference).
 */
export interface PlanCheckoutResponse {
  data: { url: string | null; plan: Exclude<PlanCode, "free" | "enterprise">; interval: PlanInterval; amount_cents: number; changed?: boolean };
  request_id?: string;
}

export interface PortalResponse {
  data: { url: string };
  request_id?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  checks: Record<string, unknown>;
  version?: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type DeviceTokenResult =
  | { status: "approved"; accessToken: string; tokenType: string; scope: string }
  | { status: "pending" }
  | { status: "expired" };

export interface TelemetryEvent {
  event: string;
  anonymous_id: string;
  source: "cli" | "mcp" | "sdk";
  properties?: Record<string, unknown>;
}

/** Loosely typed OpenAPI 3.1 document served at /openapi.json. */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string; [key: string]: unknown };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
