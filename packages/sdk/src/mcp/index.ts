import { checkoutLinkToolSchema, checkoutStatusResultSchema, checkoutStatusSchema, helpQuerySchema, billingLinkResultSchema, helpResultSchema, payInvoiceSchema, pricingResultSchema, purchasePlanSchema, purchaseResultSchema } from "./support.js";
/**
 * Shared MCP tool definitions for the Car Image API.
 *
 * Both MCP servers import from here so agents see identical tools:
 *   - the stdio server in `@meterapp/car-image` (`car-image mcp`), which calls the REST API, and
 *   - the remote Streamable HTTP server at https://carimage.dev/api/mcp, which executes
 *     against the server libraries directly.
 *
 * This module needs `zod` (an optional peer dependency of the SDK). The main
 * entry point of the SDK has no runtime dependencies.
 */
import * as z from "zod";
import { isColor } from "../params.js";
import {
  CATALOG,
  CHECK_STATUSES,
  COLORS,
  CREDITS_PER_3D_MODEL,
  CREDITS_PER_DOLLAR,
  CREDITS_PER_IMAGE,
  DEFAULT_BASE_URL,
  FITS,
  FORMATS,
  FRAMINGS,
  FREE_CREDITS,
  FREE_COURTESY_VEHICLE_IMAGES,
  FREE_VEHICLE_IMAGES,
  PLAN_ALLOWANCES,
  IDEMPOTENCY_KEY_PATTERN,
  MAX_CHECK_VEHICLES,
  MAX_CHECK_VIEWS_VEHICLES,
  ASPECT_RATIOS,
  RESOLUTIONS,
  type Resolution,
  MAX_PADDING_PERCENT,
  MIN_YEAR,
  MODEL_3D_FILE_KINDS,
  REFERRAL_SOURCES,
  REQUEST_FORMATS,
  REQUEST_KINDS,
  REQUEST_SORTS,
  REQUEST_STATUSES,
  SIZES,
  MARKET_PATTERN,
  VEHICLE_ID_PATTERN,
  VIEWS,
  IMAGE_REPORT_CATEGORIES,
  IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH,
  IMAGE_REPORT_REASON_MAX_LENGTH,
  IMAGE_REPORT_STATUSES,
  IMAGE_REPORT_TYPES,
  type Format,
  type RequestFormat,
} from "../types.js";
import type { NearLimitUpgrade } from "../types.js";
import { SDK_VERSION } from "../version.js";

/** The 3D price as agents read it: "100 credits ($1.00)". */
const RESOLUTION_NAMES = Object.keys(RESOLUTIONS) as [Resolution, ...Resolution[]];
/** What an image's own size is, wherever the tools state a size limit. */
const STORED_SIZE_NOTE = "1024 px square for older renders, up to 2560 px for new ones";
const MODEL_3D_PRICE = `${CREDITS_PER_3D_MODEL.toLocaleString("en-US")} credits`;

/**
 * Catalog size as agents read it in the instructions and tool descriptions.
 * Derived from CATALOG so the figures cannot drift from the database; agents
 * pick tools off these numbers, so understating them costs real calls.
 */
const CATALOG_MAKES = CATALOG.makes.toLocaleString("en-US");
const CATALOG_MODELS = CATALOG.models.toLocaleString("en-US");
const CATALOG_YEARS = `${CATALOG.yearFrom}-${CATALOG.yearTo}`;

export const MCP_SERVER_INFO = {
  name: "car-image-api",
  title: "Car Image API",
  version: SDK_VERSION,
  websiteUrl: DEFAULT_BASE_URL,
} as const;

/**
 * What every Car Image MCP server declares. Its tools are fixed for its life
 * (the toolset is chosen at start or by the URL), so it never announces a
 * changed list, and says so: the MCP SDK declares `tools.listChanged: true`
 * unless told otherwise, and a 2026-07-28 client that reads it holds a
 * `subscriptions/listen` stream open for a change that never comes. Claude
 * Code 2.1.288 does, on each server that declares it; on the hosted servers
 * the stream lived until the function's time limit, then the client reopened
 * it and listed the tools again, every minute of every open session. From
 * 2026-10-05 to midday 10-07 the catalog server answered 18,800 listens and
 * 21,700 tools/list calls, and 40 tool calls.
 */
export const MCP_SERVER_CAPABILITIES = { tools: { listChanged: false } } as const;

/**
 * Which tools a server exposes. `core`, the stdio default, is what an agent needs to
 * look a vehicle up, render it and watch the balance (the 2026-09-29 audit of
 * the public surface found those carrying all of the MCP traffic), plus the
 * four feedback tools every fleet product puts in its default list
 * (docs/customer-feedback.md): request a feature, report an issue, upvote,
 * review. `all`
 * adds make logos, 3D models, image options, the API reference, pricing, help
 * and billing links, plus the tools that are served but kept out of the public
 * reference ({@link MCP_UNLISTED_TOOLS}), on the hosted endpoint by default and with `car-image mcp --toolset all` locally. Fewer, sharper
 * tools cost less context and make the right one easier to pick. `all` lists
 * the core tools first: tools/list order is what a host shows.
 */
export const MCP_TOOLSETS = {
  core: [
    "resolve_vehicle",
    "search_vehicles",
    "decode_vin",
    "check_vehicles",
    "get_image_availability",
    "get_car_image",
    "create_car_image_urls",
    "get_account",
    "request_feature",
    "report_issue",
    "upvote_feedback",
    "submit_review",
  ],
  all: [
    "resolve_vehicle",
    "search_vehicles",
    "decode_vin",
    "check_vehicles",
    "get_image_availability",
    "get_car_image",
    "create_car_image_urls",
    "get_account",
    "request_feature",
    "report_issue",
    "upvote_feedback",
    "submit_review",
    "report_image",
    "list_feedback",
    "get_feedback",
    "list_my_feedback",
    "remove_feedback_vote",
    "comment_on_feedback",
    "list_reviews",
    "get_make_logo",
    "create_3d_model",
    "get_3d_model",
    "publish_3d_model",
    "list_image_options",
    "describe_api",
    "get_pricing",
    "search_help",
    "create_checkout_link",
    "get_billing_link",
    "purchase_plan",
    "pay_invoice",
    "checkout_status",
    "list_members",
    "list_webhooks",
    "list_requests",
    "request_vehicle",
    "get_request",
    "upvote_request",
    "comment_on_request",
    "share_building",
    "share_referral",
  ],
} as const;
export type McpToolset = keyof typeof MCP_TOOLSETS;

/**
 * Served on `all`, absent from the public reference since the 2026-09-30
 * audit: the original request-board tools (the canonical feedback tools replace them; they keep
 * working) and the two "about you" tools. The docs, both READMEs, the OpenAPI
 * description and the plugin skills never name them
 * (app/_lib/client-surface-contract.test.ts), and what the reference says
 * `?toolset=all` adds is {@link MCP_DOCUMENTED_EXTRAS}.
 */
export const MCP_UNLISTED_TOOLS = [
  "list_requests",
  "request_vehicle",
  "get_request",
  "upvote_request",
  "comment_on_request",
  "share_building",
  "share_referral",
] as const;

/** The tools `?toolset=all` adds that the public reference documents: `all` minus `core` minus the unlisted ones. */
export const MCP_DOCUMENTED_EXTRAS: readonly McpToolName[] = MCP_TOOLSETS.all.filter(
  (tool) => !(MCP_TOOLSETS.core as readonly string[]).includes(tool) && !(MCP_UNLISTED_TOOLS as readonly string[]).includes(tool)
);

/**
 * Entries one check_vehicles call takes. Its answer lands in the model's
 * context, so it is far below the REST check's 2,000 (`MAX_CHECK_VEHICLES`):
 * a longer list is work for code (`car-image check <file>`, `client.checkVehicles`).
 */
export const MAX_MCP_CHECK_VEHICLES = 100;
export const DEFAULT_MCP_TOOLSET: McpToolset = "core";
export const MCP_TOOLSET_NAMES = Object.keys(MCP_TOOLSETS) as McpToolset[];

export function isMcpToolset(value: unknown): value is McpToolset {
  return typeof value === "string" && (MCP_TOOLSET_NAMES as string[]).includes(value);
}

/**
 * How much of the instructions a host is sure to show its model. Claude's
 * hosts keep the first 2,048 characters of a server's instructions and drop
 * the rest, which used to be everything from the third workflow step on: the
 * rule about signed URLs, the one about a 402, the missing-vehicle rule. What
 * an agent must know to use the tools well and safely is therefore written
 * in the shared instructions and kept under this length ({@link mcpInstructionsHead}).
 * Tool-specific guidance belongs in the tool descriptions.
 */
export const MCP_INSTRUCTIONS_HEAD_LIMIT = 2048;

/**
 * The missing-vehicle rule, the same on every toolset: the request board's
 * tools are served on `all` but out of the public reference, so the
 * instructions no longer steer an agent to them.
 */
const HEAD_MISSING = "tell the human the catalog does not carry it and stop";

/** The 3D rule, shown only where create_3d_model is a tool the host has. */
const HEAD_3D = "Confirm with the human before calling create_3d_model. ";

function toolsetHas(toolset: McpToolset, tool: McpToolName): boolean {
  return (MCP_TOOLSETS[toolset] as readonly string[]).includes(tool);
}

/**
 * The part of the instructions every host shows: what this is, the two steps,
 * what is free and when to stop. App directory reviews (OpenAI's 2026-10-23
 * scan flagged these instructions and get_account) hold back a server whose
 * instructions talk about credits, prices or purchases, so this text names
 * only what is free; the paid tools' own descriptions and the 402 body carry
 * the rest.
 */
export function mcpInstructionsHead(toolset: McpToolset = DEFAULT_MCP_TOOLSET): string {
  return `Car Image API by Meter provides vehicle images from the @meterapp/vehicle-db catalog in nine views and any paint color.

First look the vehicle up with resolve_vehicle, search_vehicles or decode_vin. Use check_vehicles for up to ${MAX_MCP_CHECK_VEHICLES} vehicles at once. Include the requested year. If the user gave no year, state which year you selected. Use the returned vehicle id as vehicle for subsequent calls. If confidence is low or the year differs, ask the user before proceeding. If there is no match, ${HEAD_MISSING}. Never substitute another vehicle.

Use get_image_availability to check prepared views and quality without rendering. In ChatGPT, create_car_image_urls shows the image card. For an image in chat, request ttl_seconds: 604800, max_uses: 0 and renew: false. Other chat hosts can display get_car_image. Use signed URLs for pages, apps, emails and documents, or when the host cannot display image bytes. Reuse a valid URL and link to it if the card is unavailable. Use one image call per requested image. Never place the API key in URLs, logs or client code.

Catalog lookups are free. A new account includes ${FREE_VEHICLE_IMAGES} free vehicle images in total and ${FREE_COURTESY_VEHICLE_IMAGES} more as a one-time courtesy after those run out. A vehicle image is one vehicle in one color from one view. Confirm the count before expanding a batch the user did not size. ${toolsetHas(toolset, "create_3d_model") ? HEAD_3D : ""}On HTTP 402, stop and share any link in the response. On HTTP 429, honor retry_after or reset_at when present.

Use feedback tools when requested. Confirm the text before posting or replacing a public review.`;
}

/** The server instructions are concise so every host can show them in full. */
export function mcpInstructions(toolset: McpToolset = DEFAULT_MCP_TOOLSET): string {
  return mcpInstructionsHead(toolset);
}

/** Instructions for the full toolset; kept for callers that predate toolsets. */
export const MCP_INSTRUCTIONS = mcpInstructions("all");

/*
 * Numbers are coerced (`z.coerce.number()`), as the year always was: a host
 * that holds no typed schema for a tool passes every argument as text
 * ("960"), and refusing that costs the agent a call and, in practice, the
 * layout it asked for. The advertised JSON Schema is unchanged by it. Flags
 * and lists stay strict in these schemas: accepting "true" here would mean
 * advertising a union type, which some hosts' function schemas cannot
 * express. The servers read those from text before validating instead
 * (`readingTextArguments`, below).
 */
const yearSchema = z.coerce
  .number()
  .int()
  .min(MIN_YEAR)
  .max(2100)
  .describe(`Model year, e.g. 2024. The catalog covers ${MIN_YEAR} through next year. Omit when vehicle is given.`);

/** A paint color: a preset name, a CSS color name, or a hex such as `#1a2b3c` (`1a2b3c` and `#rgb` are accepted too). */
export const colorSchema = z
  .string()
  .min(1)
  .max(24)
  .refine(isColor, { message: `color must be one of ${COLORS.join(", ")}, a CSS color name such as navy, or a hex like #1a2b3c` })
  .describe(`Paint color: one of the presets (${COLORS.join(", ")}), a CSS color name such as navy (grey is the gray preset) or a hex like #1a2b3c. Responses echo any paint but a preset as #rrggbb.`);

/**
 * The market of sale, where a tool takes one. A plain two-letter string: the
 * server reads it in any case, answers in upper case and refuses a code no
 * country holds.
 */
export const marketSchema = z
  .string()
  .regex(MARKET_PATTERN, "market must be an ISO 3166-1 alpha-2 country code such as US, GB, DE, AU or JP")
  .describe(
    "Market of sale, an ISO 3166-1 alpha-2 country code such as US, GB, DE, AU or JP. Send it only when the human named a market or the vehicles are for one: some model years look different in different markets. Today every market gets the default appearance, and the answer's appearance says which was served. Omit it otherwise: the account's default market applies, if it set one. Never guess it from where the human is."
  );

/** A stable catalog vehicle id, as every catalog tool returns it. */
export const vehicleIdSchema = z
  .string()
  .regex(VEHICLE_ID_PATTERN, "vehicle must be a vehicle id: veh_ followed by 13 characters")
  .describe("Stable vehicle id such as veh_395yw8tn73ff8, as resolve_vehicle (params.vehicle_id), search_vehicles and decode_vin return it. The preferred way to name a vehicle: it cannot be misspelled. It names the make, model and year, so omit those when it is given.");

const vehicleFields = {
  vehicle: vehicleIdSchema.optional(),
  make: z.string().min(1).max(80).optional().describe('Manufacturer, e.g. "Porsche", "BMW", "Toyota". Case and punctuation do not matter. Prefer vehicle; omit when it is given.'),
  model: z.string().min(1).max(80).optional().describe('Model as the catalog spells it, e.g. "911", "M3", "mx-5". Look it up (resolve_vehicle, search_vehicles) rather than typing it from memory: prefer vehicle. Conservative typos and reviewed vehicle-db aliases are accepted; BMW petrol badges preserve explicit bodies (430-gran-coupe). Matches must exist for the requested make/year; ambiguous matches remain 404s. Omit when vehicle is given.'),
  year: yearSchema.optional(),
};

/** Either the vehicle id or all three of make, model and year; the server rejects both together. */
function namesOneVehicle(input: { vehicle?: string; make?: string; model?: string; year?: number }): boolean {
  return input.vehicle !== undefined
    ? input.make === undefined && input.model === undefined && input.year === undefined
    : input.make !== undefined && input.model !== undefined && input.year !== undefined;
}
const ONE_VEHICLE = { message: "Give either vehicle (a veh_… id) or all of make, model and year" };

/**
 * One entry of check_vehicles. Loose on purpose: the server answers an entry
 * it cannot read as invalid, on its own, instead of the whole list being
 * refused for one bad row.
 */
const checkEntrySchema = z.object({
  vehicle: z.string().max(40).optional().describe("A stored vehicle id (veh_…) to confirm. Omit make, model and year with it."),
  make: z.string().max(120).optional().describe('Make as the list spells it, e.g. "Mazda".'),
  model: z.string().max(120).optional().describe('Model as the list spells it, e.g. "MX-5 Miata". Send it as written: the check reads it by the image tools\' rules.'),
  year: z.coerce.number().int().optional().describe("Model year, e.g. 2018."),
  ref: z.coerce.string().max(200).optional().describe("Your id for the entry (a row, a SKU), echoed back with its answer."),
  market: z.string().max(80).optional().describe("This entry's own market of sale (a two-letter country code), when it differs from the list's market. Any other value is ignored."),
});

export const imageInputSchema = z
  .object({
    ...vehicleFields,
    view: z
      .enum(VIEWS)
      .default("front-3-4")
      .describe(
        "Camera angle, in yaw order around the car: front (0°), front-3-4 (35°, the classic hero angle, nose left), side (profile, nose left), rear-3-4 (145°, nose left), rear (180°), rear-3-4-right (215°, nose right), side-right (profile, nose right), front-3-4-right (325°, the hero angle mirrored, nose right), then top (straight down from above, nose up: a bird's-eye plan view)."
      ),
    color: colorSchema.default("silver"),
    size: z
      .enum(["thumb", "small", "medium", "large"])
      .optional()
      .describe(
        `Square size preset: thumb=${SIZES.thumb}, small=${SIZES.small}, medium=${SIZES.medium}, large=${SIZES.large} px. Omit for the stored image's full size.`
      ),
    width: z.coerce.number().int().min(1).optional().describe(`Explicit width in px; overrides size. With height too, the output is exactly width x height. Delivered up to the stored image's own size, ${STORED_SIZE_NOTE}: a larger size is clamped, a box shrinking whole and keeping its shape (1920 x 1080 of a 1024 px image is delivered as 1024 x 576).`),
    height: z.coerce.number().int().min(1).optional().describe("Explicit height in px (a size above the stored image's own is clamped, see width)."),
    aspect_ratio: z
      .enum(ASPECT_RATIOS)
      .optional()
      .describe("A preset for the box: 1:1, 4:3, 3:2 or 16:9, at the resolution you name or the largest the image allows; natural = the car's own trimmed shape. With width or height it completes the other; both together win. Never with size."),
    resolution: z
      .enum(RESOLUTION_NAMES)
      .optional()
      .describe(`A preset for the longer side of the box: small=${RESOLUTIONS.small}, medium=${RESOLUTIONS.medium}, hd=${RESOLUTIONS.hd}, 2k=${RESOLUTIONS["2k"]} px, delivered up to the stored image's own size. width or height win. Never with size.`),
    fit: z
      .enum(FITS)
      .optional()
      .describe("With width and height: contain (default) keeps the whole car and pads the rest; cover fills the box and crops; inside may return a smaller image."),
    background: z
      .string()
      .max(24)
      .optional()
      .describe('Solid background: a hex color such as "#f4f4f4" or a CSS color name such as "white" or "whitesmoke". Omit for transparent (jpg is white).'),
    framing: z
      .enum(FRAMINGS)
      .optional()
      .describe("Composition preset, instead of trim/padding (never with them): consistent (default) keeps one apparent scale across the vehicle's views, for galleries and spinners; tight = trim with no margin, the car fills the box; balanced = trim with a 6% margin, for catalog grids and listings."),
    trim: z.boolean().optional().describe("Crop to the car's own bounds before sizing, so it fills the box instead of floating in the frame."),
    padding: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_PADDING_PERCENT)
      .optional()
      .describe(`Margin around the image, percent of its longer side (0-${MAX_PADDING_PERCENT}): around the car with trim, around the stored frame without it.`),
    shadow: z
      .boolean()
      .optional()
      .describe("Add a soft ground shadow under the car, drawn from its cut-out (semi-transparent, or grey on a background). Same image, nothing extra."),
    format: z
      .enum(REQUEST_FORMATS)
      .default("png")
      .describe(
        "png keeps the transparent background (default); webp is smallest; jpg is flattened onto white; auto lets each viewer's Accept header choose webp or png, negotiated on every load of a signed URL. An inline image (get_car_image) is delivered as png for auto."
      ),
    market: marketSchema.optional(),
  })
  .refine(namesOneVehicle, ONE_VEHICLE);

export type ImageInput = z.infer<typeof imageInputSchema>;

/** Logos share image transforms, but never vehicle selectors, views or paint. */
export const makeLogoInputSchema = z.strictObject({
  make: z.string().trim().min(1).max(80).describe("Catalog make name or slug, e.g. Toyota. Use search_vehicles to find makes."),
  size: imageInputSchema.shape.size,
  width: imageInputSchema.shape.width,
  height: imageInputSchema.shape.height,
  fit: imageInputSchema.shape.fit.describe("contain pads the box; cover fills and crops; inside may return a smaller image."),
  background: imageInputSchema.shape.background,
  trim: z.boolean().optional().describe("Crop to the logo's bounds before sizing."),
  padding: imageInputSchema.shape.padding.describe("Margin around a trimmed logo, 0-50 percent; requires trim: true."),
  format: imageInputSchema.shape.format.describe("png (default), webp, jpg or auto; auto delivers PNG inline."),
}).refine((input) => input.padding === undefined || input.trim === true, { message: "padding requires trim: true" });

export const MAKE_LOGO_NOTICE = "Logos are third-party trademarks. They are served for referential display of the make they identify, no license is granted, and they sit outside every VehiclesDB indemnity — see the API terms.";

/**
 * The encoding an inline image (`get_car_image`) is delivered in. `auto` is
 * negotiated from an HTTP `Accept` header, which a tool call does not carry,
 * so both servers deliver png for it: every MCP host decodes png, and the
 * same input yields the same bytes over stdio and over HTTP. Signed URLs keep
 * `auto` and negotiate per load.
 */
export function inlineImageFormat(format: RequestFormat): Format {
  return format === "auto" ? "png" : format;
}

export const MCP_TOOL_SCHEMAS = {
  get_car_image: imageInputSchema,
  get_make_logo: makeLogoInputSchema,
  create_car_image_urls: z.object({
    images: z
      .array(imageInputSchema)
      .min(1)
      .max(50)
      .describe("One to fifty image requests. Each URL counts its vehicle image (vehicle, color, angle) for the month when created; the same image again this month adds nothing."),
    ttl_seconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(7 * 24 * 60 * 60)
      .optional()
      .describe("How long the URLs stay valid, 60 to 604800 seconds (7 days). Default 3600."),
    max_uses: z.coerce
      .number()
      .int()
      .min(0)
      .max(1000)
      .optional()
      .describe("Maximum redemptions per URL, 0 to 1000; 0 (default) means unlimited until expiry."),
    renew: z
      .boolean()
      .optional()
      .describe(
        "Auto-renew past the TTL: the first load in each further window of ttl_seconds renews the URL, until renew_days (no extra count on a plan; one more credit per window on the legacy credit meter, so pair with ttl_seconds 604800). Use for email, CMS pages and documents that outlive a TTL. Requires max_uses 0."
      ),
    renew_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("How long a renewable URL keeps renewing, 1 to 365 days from creation (default 365). Only with renew: true."),
    market: marketSchema.optional().describe("Market of sale for every image that names none of its own: a two-letter country code such as AU. Only when the human named a market; otherwise omit (the account's default applies, if set)."),
    idempotency_key: z
      .string()
      .regex(IDEMPOTENCY_KEY_PATTERN, 'Use 1-255 characters of letters, digits, ".", "_", ":" or "-".')
      .optional()
      .describe(
        "Makes a retry safe. The same key with the same arguments within 24 hours replays the first result (idempotent_replayed: true) instead of minting and billing again; the same key with different arguments is refused; a retry that overtakes a call still running is told to wait. Pass one whenever the call might be repeated, e.g. one per listing or batch."
      ),
  }),
  search_vehicles: z.object({
    query: z
      .string()
      .min(1)
      .max(120)
      .describe('Free text: make and/or model, optional year, typos tolerated, e.g. "porshe 911" or "2019 f150". Fewer words find more: every word must be in the name of one catalog vehicle.'),
    year: z.coerce.number().int().min(MIN_YEAR).max(2100).optional().describe("Restrict results to one model year."),
    limit: z.coerce.number().int().min(1).max(25).default(10).describe("Maximum number of results (1-25)."),
  }),
  get_image_availability: z.object({
    ...vehicleFields,
    view: z.enum(VIEWS).optional().describe("Check one camera view; omit to check all nine views."),
    color: colorSchema.default("silver"),
    market: marketSchema.optional(),
  }).refine(namesOneVehicle, ONE_VEHICLE),
  check_vehicles: z.object({
    vehicles: z
      .array(checkEntrySchema)
      .min(1)
      .max(MAX_MCP_CHECK_VEHICLES)
      .describe(`1 to ${MAX_MCP_CHECK_VEHICLES} vehicles, each {make, model, year} as the list spells them or {vehicle} for a stored id, with an optional ref echoed back.`),
    views: z
      .boolean()
      .optional()
      .describe("true: each match also says which of its nine camera views are prepared now, as get_image_availability reports them (views.prepared 0-9 and views.missing), and which of the prepared ones are verified (views.verified). Free and read-only. Default false."),
    market: marketSchema.optional().describe("Market of sale the list is for: a two-letter country code such as AU. Only when the human named a market or the list is for one; otherwise omit (the account's default applies, if set). An entry may name its own."),
  }),
  resolve_vehicle: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe('What the human asked for, in words: year, make and model, plus the view and color when they named them, e.g. "red 2024 porsche 911 side view".'),
    market: marketSchema.optional(),
  }),
  list_image_options: z.object({}),
  get_account: z.object({}),
  list_members: z.object({}),
  list_webhooks: z.object({}),
  report_image: z.strictObject({
    type: z
      .enum(IMAGE_REPORT_TYPES)
      .optional()
      .describe("wrong_image: the wrong car, angle or paint. poor_quality: the right car, badly drawn. missing_vehicle: the catalog lacks the vehicle (make, model and year only, no image). Default: poor_quality for category quality, else wrong_image."),
    category: z
      .enum(IMAGE_REPORT_CATEGORIES)
      .optional()
      .describe("What is wrong with the image: identity (the wrong vehicle or generation, the default), camera (the wrong angle) or paint for wrong_image; quality for poor_quality. Omit for missing_vehicle."),
    asset_id: z.string().uuid().optional().describe("The image asset id, when a response returned one."),
    request_id: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe("The request_id returned with the image by get_car_image or create_car_image_urls. With asset_id, the preferred way to name the image."),
    vehicle: vehicleIdSchema.optional(),
    make: z.string().min(1).max(80).optional().describe("Otherwise name the image by vehicle (a vehicle id, or make, model and year, with view and color). For missing_vehicle: the make as the human gave it."),
    model: z.string().min(1).max(80).optional().describe("With make: the model. For missing_vehicle, as the human gave it."),
    year: z.coerce.number().int().min(1900).max(2100).optional().describe("With make and model: the model year. Required for missing_vehicle."),
    view: z.enum(VIEWS).optional().describe("With a vehicle: the view of the image."),
    color: colorSchema.optional(),
    reason: z
      .string()
      .max(IMAGE_REPORT_REASON_MAX_LENGTH)
      .optional()
      .describe("What is wrong, in a line, e.g. 'shows the previous generation'. No personal data."),
    external_ref: z
      .string()
      .max(IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH)
      .optional()
      .describe("The human's own id for the report, such as a ticket in their app; returned on the report and in its webhooks. No personal data."),
  }),
  get_pricing: z.object({}),
  search_help: helpQuerySchema,
  create_checkout_link: checkoutLinkToolSchema,
  get_billing_link: z.object({}),
  purchase_plan: purchasePlanSchema,
  pay_invoice: payInvoiceSchema,
  checkout_status: checkoutStatusSchema,
  describe_api: z.object({
    endpoint: z
      .string()
      .max(120)
      .optional()
      .describe('Filter by path fragment or keyword, e.g. "images/car", "image-urls", "vin", "3d". Omit for the full compact reference.'),
  }),
  decode_vin: z.object({
    vin: z
      .string()
      .min(5)
      .max(40)
      .describe("A full 17-character VIN, or a partial VIN of at least 5 characters with * for each unknown position. Case, spaces and dashes do not matter."),
    year: z.coerce.number().int().min(1900).max(2100).optional().describe("Model-year hint for the decoder; it flags a mismatch with the VIN's own year position."),
  }),
  create_3d_model: z
    .object({
      ...vehicleFields,
      color: colorSchema.default("silver"),
      webhook_url: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe("Public https URL that receives one POST {event: '3d_model.ready' | '3d_model.failed', data, sent_at} when the model settles; retried with backoff up to five times."),
      webhook_secret: z.string().min(1).max(256).optional().describe("With webhook_url: the POST body is signed as X-CarImage-Signature: sha256=<hex HMAC of the raw body>."),
      publish: z
        .boolean()
        .optional()
        .describe("true publishes the model at once: data.public carries key-free URLs and a two-line embed (data.public.embed.html) whose files appear when the model is ready. Free; the same as publish_3d_model afterwards."),
      idempotency_key: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{1,255}$/, "idempotency_key must be 1-255 characters of letters, digits, '.', '_', ':' or '-'")
        .optional()
        .describe("A retry with the same key replays the first answer instead of charging again (24 h); use it when a call may be repeated."),
    })
    .refine(namesOneVehicle, ONE_VEHICLE),
  get_3d_model: z.object({
    id: z.string().uuid().describe("The 3D request id returned by create_3d_model."),
  }),
  publish_3d_model: z.object({
    id: z.string().uuid().describe("The 3D request id returned by create_3d_model."),
    unpublish: z.boolean().optional().describe("true takes the model down again: its public URLs stop working within the hour and data.public becomes null. Default false (publish)."),
  }),
  list_requests: z.object({
    kind: z.enum(REQUEST_KINDS).optional().describe("Only vehicle requests or only feature requests. Omit for both."),
    status: z
      .enum(REQUEST_STATUSES)
      .optional()
      .describe("Filter by status. Omit for everything that is not declined."),
    sort: z.enum(REQUEST_SORTS).default("top").describe("top = most upvotes first (default); new = most recent first."),
    limit: z.coerce.number().int().min(1).max(100).default(25).describe("Maximum number of requests (1-100)."),
    cursor: z.string().max(200).optional().describe("next_cursor from a previous page, to read the next one."),
  }),
  request_vehicle: z.object({
    make: z.string().min(1).max(80).describe('Manufacturer, e.g. "Rivian". Case does not matter.'),
    model: z.string().min(1).max(80).describe('Model, e.g. "R1T".'),
    year: z.coerce.number().int().min(1900).max(2035).optional().describe("Model year, if it matters. Omit to ask for the model in general."),
    note: z.string().max(2000).optional().describe("Why it is needed, body style, trim; anything that helps prioritise."),
    market: marketSchema.optional().describe("The market of sale the request is about, a two-letter country code such as AU, when the human named one."),
  }),
  request_feature: z.object({
    title: z.string().min(1).max(140).describe('Short summary, e.g. "Interior views".'),
    body: z.string().max(5000).optional().describe("Details: the use case, what the output should look like."),
    force: z.boolean().optional().describe("File it even though similar items exist. Only after checking that none of the returned similar items matches."),
  }),
  report_issue: z.object({
    title: z.string().min(1).max(140).describe('What went wrong, in a line, e.g. "Side views of the 2024 Camry return 502". No keys or personal data.'),
    body: z.string().max(5000).optional().describe("What was called, what was expected, what happened."),
    request_id: z.string().min(1).max(100).optional().describe("The request_id of the failed call (from its error or X-Request-Id). The single most useful thing to attach."),
    context: z
      .object({
        endpoint: z.string().max(200).optional().describe("The tool or path that failed, e.g. get_car_image or /api/v1/images/car."),
        error_code: z.string().max(80).optional().describe("The error code or status the call returned."),
        vehicle: z.string().max(32).optional().describe("The vehicle id (veh_…) involved."),
        view: z.string().max(24).optional().describe("The view involved, e.g. side."),
        color: z.string().max(24).optional().describe("The paint color involved."),
        asset_id: z.string().max(36).optional().describe("The image asset id, when one was returned."),
        model_3d_id: z.string().max(36).optional().describe("The 3D request id, for a 3D model problem."),
        client: z.string().max(80).optional().describe("The host or client, e.g. Claude Code."),
        client_version: z.string().max(40).optional().describe("Its version."),
      })
      .optional()
      .describe("The identifiers of what went wrong. Checked against the account's own requests; never shown publicly."),
    force: z.boolean().optional().describe("File it even though similar reports exist."),
  }),
  list_feedback: z.object({
    kind: z.enum(REQUEST_KINDS).optional().describe("feature, issue (published ones only) or vehicle. Omit for all."),
    status: z.enum(REQUEST_STATUSES).optional().describe("Filter by status. Omit for everything that is not declined or merged."),
    sort: z.enum(REQUEST_SORTS).default("top").describe("top = most votes (default); new = newest; recent_activity = latest vote, comment or change."),
    q: z.string().max(200).optional().describe("Search titles and bodies."),
    limit: z.coerce.number().int().min(1).max(100).default(25).describe("Maximum number of items (1-100)."),
    cursor: z.string().max(200).optional().describe("next_cursor from a previous page."),
  }),
  get_feedback: z.object({
    id: z.string().uuid().describe("The item id from list_feedback, request_feature or report_issue."),
  }),
  list_my_feedback: z.object({
    kind: z.enum(REQUEST_KINDS).optional().describe("Only one kind. Omit for all."),
    status: z.enum(REQUEST_STATUSES).optional().describe("Only one status. Omit for all."),
    limit: z.coerce.number().int().min(1).max(100).default(25).describe("Maximum number of items (1-100)."),
    cursor: z.string().max(200).optional().describe("next_cursor from a previous page."),
  }),
  upvote_feedback: z.object({
    id: z.string().uuid().describe("The item id to upvote. Idempotent."),
  }),
  remove_feedback_vote: z.object({
    id: z.string().uuid().describe("The item id to remove the vote from. Idempotent."),
  }),
  comment_on_feedback: z.object({
    id: z.string().uuid().describe("The item id to comment on."),
    body: z.string().min(1).max(2000).describe("The comment (1-2000 characters)."),
  }),
  submit_review: z.object({
    rating: z.coerce.number().int().min(1).max(5).describe("1 to 5 stars, the human's own rating."),
    title: z.string().max(120).optional().describe("A headline, in the human's words."),
    body: z.string().max(2000).optional().describe("The review, in the human's words."),
    likes: z.string().max(1000).optional().describe("What works well."),
    dislikes: z.string().max(1000).optional().describe("What could be better."),
    use_case: z.string().max(200).optional().describe("What they use the API for."),
    display_name: z.string().max(80).optional().describe("The name to show. Defaults to their first name."),
    display_company: z.string().max(120).optional().describe("A company to show, only if they want one."),
    marketing_consent: z.boolean().optional().describe("true only if the human agreed that Car Image may quote it in marketing. Default false."),
  }),
  list_reviews: z.object({
    sort: z.enum(["newest", "highest", "lowest"]).default("newest").describe("Order of the reviews."),
    rating: z.coerce.number().int().min(1).max(5).optional().describe("Only reviews with this rating."),
    limit: z.coerce.number().int().min(1).max(100).default(20).describe("Maximum number of reviews (1-100)."),
    cursor: z.string().max(200).optional().describe("next_cursor from a previous page."),
  }),
  get_request: z.object({
    id: z.string().uuid().describe("The request id from list_requests, request_vehicle or request_feature."),
  }),
  upvote_request: z.object({
    id: z.string().uuid().describe("The request id to upvote. Idempotent."),
  }),
  comment_on_request: z.object({
    id: z.string().uuid().describe("The request id to comment on."),
    body: z.string().min(1).max(2000).describe("The comment (1-2000 characters)."),
  }),
  share_building: z.object({
    building: z.string().min(1).max(2000).describe("What the human is building with the API, in their words (1-2000 characters)."),
  }),
  share_referral: z.object({
    source: z.enum(REFERRAL_SOURCES).describe("Where the human first heard about Car Image API."),
    detail: z.string().max(500).optional().describe('Optional specifics, e.g. the article, the person, or the search query.'),
  }),
} as const;

export type McpToolName = keyof typeof MCP_TOOL_SCHEMAS;
export type McpToolInput<N extends McpToolName> = z.infer<(typeof MCP_TOOL_SCHEMAS)[N]>;

/* ------------------------------------------------------ arguments as text ---
 *
 * A host that holds no typed schema for a tool passes on what the model wrote
 * as text: `trim: "true"`, `width: "960"`, and the `images` list as the JSON
 * it was written in. Read against the schema the tool advertises, each of
 * those is the value that was meant, and refusing it left such a host unable
 * to mint a URL at all ("images: expected array, received string"). Both
 * servers therefore register their tools through `readingTextArguments`.
 * What they advertise stays the zod schema's own JSON Schema.
 */

/** The parts of an advertised JSON Schema the reader goes by. */
interface AdvertisedSchema {
  type?: unknown;
  properties?: Record<string, AdvertisedSchema>;
  items?: AdvertisedSchema;
  anyOf?: AdvertisedSchema[];
}

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Combined array elements and object members accepted by every MCP server. */
export const MAX_MCP_TOOL_INPUT_ELEMENTS = 10_000;

class McpInputBudgetError extends Error {
  constructor() {
    super(`Tool arguments contain more than the maximum of ${MAX_MCP_TOOL_INPUT_ELEMENTS} elements`);
  }
}

/** Count iteratively before recursive schema reading, including decoded text values. */
function countToolInputElements(value: unknown, budget: { elements: number }): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null) continue;
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (++budget.elements > MAX_MCP_TOOL_INPUT_ELEMENTS) throw new McpInputBudgetError();
      const child = (node as Record<string, unknown>)[key];
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
}

/**
 * `value` as the type `schema` advertises for it, when a host sent it as text:
 * "true" for a boolean, "960" for a number, the JSON of a list or an object,
 * and the same for what a list or an object holds. Text that is none of
 * those, and text where the schema asks for text, comes back as it was, for
 * validation to judge.
 */
export function readTextArgument(value: unknown, schema: AdvertisedSchema | undefined): unknown {
  const budget = { elements: 0 };
  countToolInputElements(value, budget);
  return readTextArgumentWithinBudget(value, schema, budget);
}

function readTextArgumentWithinBudget(value: unknown, schema: AdvertisedSchema | undefined, budget: { elements: number }): unknown {
  if (!schema) return value;
  if (typeof value === "string") {
    for (const option of schema.anyOf ?? []) {
      const read = readTextArgumentWithinBudget(value, option, budget);
      if (read !== value) return read;
    }
    const text = value.trim();
    if (schema.type === "boolean") return /^true$/i.test(text) ? true : /^false$/i.test(text) ? false : value;
    if (schema.type === "integer" || schema.type === "number") return NUMBER_TEXT.test(text) ? Number(text) : value;
    if ((schema.type === "array" && text.startsWith("[")) || (schema.type === "object" && text.startsWith("{"))) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: validation says what was expected.
        return value;
      }
      if (schema.type === "array" ? Array.isArray(parsed) : isRecord(parsed)) {
        countToolInputElements(parsed, budget);
        return readTextArgumentWithinBudget(parsed, schema, budget);
      }
    }
    return value;
  }
  if (Array.isArray(value)) return schema.type === "array" ? value.map((item) => readTextArgumentWithinBudget(item, schema.items, budget)) : value;
  if (isRecord(value) && schema.properties) {
    const { properties } = schema;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readTextArgumentWithinBudget(item, properties[key], budget)]));
  }
  return value;
}

/** A tool's input schema as an MCP server takes it: what validates, and the JSON Schema to advertise. */
export type McpInputSchema<S extends z.ZodType> = Pick<S, "~standard">;

const TEXT_READERS = new WeakMap<z.ZodType, McpInputSchema<z.ZodType>>();

/**
 * `schema` for a server to register as a tool's input. It advertises the same
 * JSON Schema and validates by the same rules, after reading any argument a
 * host sent as text (`readTextArgument`).
 */
export function readingTextArguments<S extends z.ZodType>(schema: S): McpInputSchema<S> {
  const known = TEXT_READERS.get(schema);
  if (known) return known as McpInputSchema<S>;
  const standard = schema["~standard"];
  let advertised: AdvertisedSchema | undefined;
  const reader: McpInputSchema<S> = {
    "~standard": {
      ...standard,
      validate: (value, options) => {
        advertised ??= standard.jsonSchema.input({ target: "draft-2020-12" });
        try {
          return standard.validate(readTextArgument(value, advertised), options);
        } catch (error) {
          if (!(error instanceof McpInputBudgetError)) throw error;
          return { issues: [{ message: error.message }] };
        }
      },
    },
  };
  TEXT_READERS.set(schema, reader);
  return reader;
}

/* --------------------------------------------------------------- outputs ---
 *
 * A tool may advertise an `outputSchema` (MCP 2025-06-18 and later). Hosts show
 * it next to the input schema, validate `structuredContent` against it, and can
 * hand the model typed data instead of re-parsing the text block. The server SDK
 * enforces the promise from the other side: a tool that declares an output
 * schema and then returns no structured content, or content that does not match,
 * fails the call. Two rules follow from that, and both are load-bearing:
 *
 *   - Every object here is a `looseObject`. These payloads are the REST API's,
 *     which gains fields as the product does (`usage_30d`, `year_ranges`,
 *     `limits`). A strict object advertises `additionalProperties: false`, which
 *     would make a validating client reject a response for being newer than it.
 *   - Only what BOTH servers guarantee is required. Where the remote server and
 *     the stdio one disagreed, they were made to agree (`toVehicleMatch`,
 *     `toImageOptions`, `etag` and `credits_usd` in the stdio handlers) rather
 *     than the schema being weakened to cover both.
 *
 * `describe_api` deliberately has none: its result *is* the reference prose, and
 * restating it as structured content would double the tokens of every call.
 */

/** A real catalog vehicle suggested for one that did not match (`VehicleSuggestion`). */
const vehicleSuggestionSchema = z.looseObject({
  make: z.string(),
  make_name: z.string(),
  model: z.string().nullable(),
  model_name: z.string().nullable(),
  year: z.number().int(),
  id: z.string().nullable(),
  image_path: z.string().nullable(),
});

/** The vehicle echoed back with an image: exactly what would render it again. */
const vehicleDescriptorSchema = z.looseObject({
  /** Stable id of the catalog vehicle; null when the catalog cannot name one. */
  vehicle_id: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  view: z.enum(VIEWS),
  /** A preset name, or a hex paint as #rrggbb. */
  color: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fit: z.enum(FITS).optional(),
  background: z.string().optional(),
  trim: z.boolean().optional(),
  padding: z.number().int().optional(),
  shadow: z.boolean().optional(),
  format: z.enum([...FORMATS, "auto"]),
});

/** The organization a connection acts for, with the caller's role (null once they left; the key still works). */
const organizationSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  personal: z.boolean(),
  role: z.string().nullable(),
});

/** Images cost no credits on the plans (credits_per_image 0); credits are not sold, so credits_per_dollar and packs are legacy. */
const pricingSchema = z.looseObject({
  credits_per_image: z.number(),
  credits_per_dollar: z.number().optional(),
  free_credits: z.number().optional(),
  packs: z
    .array(z.looseObject({ credits: z.number().int(), cents: z.number().int(), label: z.string().optional() }))
    .optional(),
});

/** A vehicle-image meter count: `included` null means no cap. */
const meterCountSchema = z.looseObject({ used: z.number(), included: z.number().nullable() });

/** One catalog hit, in the single spelling both servers emit (see {@link toVehicleMatch}). */
const vehicleMatchSchema = z.looseObject({
  kind: z.enum(["make", "model"]),
  make: z.string(),
  make_slug: z.string(),
  model: z.string().nullable(),
  model_slug: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  years: z.array(z.number().int()),
  match_kind: z.string().nullable(),
});

/** Shared by the list/create/vote results and, minus the count, by the detail. */
const requestFields = {
  id: z.string(),
  kind: z.enum(REQUEST_KINDS),
  title: z.string(),
  body: z.string().nullable(),
  vehicle: z.looseObject({ make: z.string(), model: z.string(), year: z.number().int().nullable() }).nullable(),
  status: z.enum(REQUEST_STATUSES),
  votes: z.number().int(),
  author: z.string(),
  url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  viewer: z.looseObject({ voted: z.boolean() }).optional(),
};

/** create results on the canonical tools: the new item, or nothing and the matches to upvote. */
const filedFeedbackResult = z.looseObject({
  created: z.boolean(),
  data: z.looseObject({ ...requestFields, comments: z.number().int() }).nullable(),
  similar: z.array(z.looseObject({ ...requestFields, comments: z.number().int() })),
  request_id: z.string(),
});

const publicReviewSchema = z.looseObject({
  id: z.string(),
  rating: z.number().int(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  display_name: z.string(),
  created_at: z.string(),
  response: z.looseObject({ body: z.string(), responded_at: z.string() }).nullable(),
});

const reviewSummarySchema = z.looseObject({ count: z.number().int(), average: z.number().nullable(), distribution: z.looseObject({}) });

const requestCommentSchema = z.looseObject({
  id: z.string(),
  request_id: z.string(),
  body: z.string(),
  author: z.string(),
  created_at: z.string(),
});

const requestRecordSchema = z.looseObject({ ...requestFields, comments: z.number().int() });

/** On the detail the thread takes the `comments` name, so the count moves aside. */
const requestDetailSchema = z.looseObject({
  ...requestFields,
  comment_count: z.number().int(),
  comments: z.array(requestCommentSchema),
});

const requestListResult = z.looseObject({
  data: z.array(requestRecordSchema),
  next_cursor: z.string().nullable(),
  request_id: z.string(),
});

const requestResult = z.looseObject({ data: requestRecordSchema, request_id: z.string() });

const createdRequestResult = z.looseObject({
  data: requestRecordSchema,
  /** True when an open vehicle request already existed and took the vote instead. */
  deduplicated: z.boolean(),
  request_id: z.string(),
});

const timelineSchema = z.array(z.looseObject({ at: z.string(), type: z.string() }));

/** The response of GET /api/v1/vin/{vin}: every key present, unknown values null. */
const vinResultSchema = z.looseObject({
  vin: z.string(),
  valid: z.boolean(),
  errors: z.array(z.looseObject({ code: z.number().int(), text: z.string() })),
  suggested_vin: z.string().nullable(),
  year: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  trim: z.string().nullable(),
  series: z.string().nullable(),
  body_class: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  doors: z.number().int().nullable(),
  drive_type: z.string().nullable(),
  fuel_type: z.string().nullable(),
  engine: z.looseObject({
    cylinders: z.number().int().nullable(),
    displacement_l: z.number().nullable(),
    hp: z.number().nullable(),
    model: z.string().nullable(),
  }),
  transmission: z.looseObject({ style: z.string().nullable(), speeds: z.number().int().nullable() }),
  manufacturer: z.string().nullable(),
  plant: z.looseObject({ city: z.string().nullable(), state: z.string().nullable(), country: z.string().nullable() }),
  gvwr: z.string().nullable(),
  /** Every decoded vPIC variable verbatim. */
  attributes: z.record(z.string(), z.string()),
  /** The catalog vehicle the VIN maps to, with the id and path that render it; null when the catalog lacks it. */
  vehicle: z.looseObject({ id: z.string(), make: z.string(), model: z.string(), year: z.number().int(), image_path: z.string() }).nullable(),
  source: z.enum(["vpic-db", "vpic-api"]),
});

const model3dFileSchema = z.looseObject({
  /** API URL that redirects to a short-lived signed download; needs the key. */
  url: z.string(),
  bytes: z.number().int(),
  content_type: z.string(),
});

const model3dPublicFileSchema = z.looseObject({
  /** Stable, key-free URL that redirects to the CDN copy. */
  url: z.string(),
  bytes: z.number().int(),
  content_type: z.string(),
});

/** The hosted side of a published request: key-free URLs and the embed. */
const model3dPublicSchema = z.looseObject({
  id: z.string(),
  url: z.string(),
  /** Null until the model is ready and its copies were made. */
  files: z.looseObject({ glb: model3dPublicFileSchema, usdz: model3dPublicFileSchema.optional(), poster: model3dPublicFileSchema.optional() }).nullable(),
  embed: z.looseObject({ script: z.string(), html: z.string() }),
  published_at: z.string(),
});

/** A 3D request as POST /api/v1/3d and GET /api/v1/3d/{id} return it. */
const model3dSchema = z.looseObject({
  id: z.string(),
  object: z.literal("3d_model"),
  status: z.enum(["queued", "processing", "ready", "failed"]),
  /** 0-100. */
  progress: z.number(),
  stage: z.string().nullable(),
  vehicle: z.looseObject({ id: z.string().nullable(), make: z.string(), model: z.string(), year: z.number().int() }),
  /** A preset name, or a hex paint as #rrggbb. */
  color: z.string(),
  generator: z.string(),
  /** Present once status is ready. */
  files: z
    .looseObject({
      glb: model3dFileSchema.optional(),
      /** The GLB rebuilt for browsers: meshopt compression and WebP textures. */
      glb_web: model3dFileSchema.optional(),
      usdz: model3dFileSchema.optional(),
      fbx: model3dFileSchema.optional(),
      thumbnail: model3dFileSchema.optional(),
      /** Grayscale PNG aligned with the GLB's base-colour texture: white where the texel is paint. */
      paint_mask: model3dFileSchema.optional(),
    })
    .nullable(),
  polycount: z.number().int().nullable(),
  /** Set when status is failed: refunded (or pending), credits_refunded, refunded_at, and retry, one sentence on how to order again. */
  error: z
    .looseObject({
      code: z.string(),
      message: z.string(),
      image_url: z.string().optional(),
      refunded: z.boolean().optional(),
      credits_refunded: z.number().optional(),
      refunded_at: z.string().nullable().optional(),
      retryable: z.boolean().optional(),
      retry: z.string().optional(),
    })
    .nullable(),
  estimated_seconds_remaining: z.number().nullable(),
  webhook: z
    .looseObject({
      url: z.string(),
      status: z.string().nullable(),
      attempts: z.number().int(),
      last_status: z.number().int().nullable(),
      delivered_at: z.string().nullable(),
    })
    .nullable(),
  /** Key-free URLs and the embed once published; null until then. */
  public: model3dPublicSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  ready_at: z.string().nullable(),
});

export const MCP_TOOL_OUTPUT_SCHEMAS = {
  get_make_logo: z.looseObject({
    credits_charged: z.number().nullable(), credits_remaining: z.number().nullable(),
    source: z.enum(["cache", "generated"]).nullable(),
    width: z.number().int().nullable(), height: z.number().int().nullable(),
    content_type: z.string(), etag: z.string().nullable(), request_id: z.string().nullable(),
    notice: z.string(),
  }),
  get_car_image: z.looseObject({
    credits_charged: z.number().nullable(),
    /** Legacy credit meter only. */
    credits_remaining: z.number().nullable().optional(),
    /** Vehicle-image meter: the month's vehicle images after this call. */
    vehicle_images: meterCountSchema.optional(),

    source: z.enum(["cache", "generated"]).nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    content_type: z.string(),
    etag: z.string().nullable(),
    request_id: z.string().nullable(),
    vehicle: vehicleDescriptorSchema,
  }),
  create_car_image_urls: z.looseObject({
    data: z.array(
      z.looseObject({
        id: z.string(),
        /** Signed delivery URL; needs no key and is safe to put in HTML. */
        url: z.string(),
        /** Ready to paste in a chat reply; optional for results stored before this field existed. */
        markdown: z.string().optional(),
        expires_at: z.string(),
        /** 0 means unlimited redemptions until it expires. */
        max_uses: z.number().int(),
        /** Auto-renewing URLs keep serving, renewing in each opened window, until this instant. */
        renews_until: z.string().nullable().optional(),
        vehicle: vehicleDescriptorSchema,
      })
    ),
    billing: z.looseObject({
      charged_on: z.literal("creation"),
      credits_charged: z.number(),
      /** Legacy credit meter only. */
      credits_remaining: z.number().optional(),
      /** Vehicle-image meter: the month's vehicle images after this call. */
      vehicle_images: meterCountSchema.optional(),
      renewal: z.looseObject({ window_seconds: z.number(), credits_per_window: z.number().optional(), until: z.string() }).nullable().optional(),
    }),
    request_id: z.string(),
    /** True when a retry was answered from the result stored for its idempotency_key; nothing was billed again. */
    idempotent_replayed: z.boolean().optional(),
  }),
  search_vehicles: z.looseObject({
    data: z.looseObject({ query: z.string(), results: z.array(vehicleMatchSchema) }),
  }),
  get_image_availability: z.looseObject({
    data: z.looseObject({
      object: z.literal("image_availability"),
      vehicle: z.looseObject({ id: z.string().nullable(), make: z.string(), model: z.string(), year: z.number().int() }),
      color: z.string(),
      views: z.array(z.looseObject({
        view: z.enum(VIEWS),
        cached: z.boolean(),
        /** The stored image of this view is verified; false says only that it has not been verified yet. */
        verified: z.boolean().optional(),
        quality: z.enum(["standard", "enhanced", "premium"]).nullable(),
        paint_generation: z.number().int().nullable(),
        upgradable: z.boolean(),
        upgrade_reason: z.enum(["paint_generation", "quality"]).nullable(),
        upgrade_in_progress: z.boolean(),
        render_eta: z.looseObject({ typical_seconds: z.number(), slow_seconds: z.number(), samples: z.number().int() }).nullable(),
        upgrade_eta: z.looseObject({ typical_seconds: z.number(), slow_seconds: z.number(), samples: z.number().int() }).nullable(),
      })),
      summary: z.looseObject({ cached: z.number().int(), verified: z.number().int().optional(), high_quality: z.number().int(), upgradable: z.number().int() }),
      latest_paint_generation: z.number().int(),
      estimates: z.record(z.string(), z.looseObject({ typical_seconds: z.number(), slow_seconds: z.number(), samples: z.number().int() })),
    }),
    request_id: z.string(),
  }),
  check_vehicles: z.looseObject({
    data: z.looseObject({
      summary: z.looseObject({
        total: z.number().int(),
        match: z.number().int(),
        suggestion: z.number().int(),
        miss: z.number().int(),
        invalid: z.number().int(),
        /** Distinct vehicle ids among the matches. */
        distinct_vehicles: z.number().int(),
        /** With views: distinct matched vehicles whose nine views are all prepared. */
        views_complete: z.number().int().optional(),
        /** With views: distinct matched vehicles with a prepared view whose every prepared view is verified. */
        views_verified: z.number().int().optional(),
      }),
      results: z.array(
        z.looseObject({
          /** Position in `vehicles`. */
          index: z.number().int(),
          ref: z.string().optional(),
          status: z.enum(CHECK_STATUSES),
          /** For a match: the vehicle a render serves, with the id to render by. */
          vehicle: z
            .looseObject({
              id: z.string(),
              make: z.string(),
              make_name: z.string(),
              model: z.string(),
              model_name: z.string(),
              year: z.number().int(),
              /** The rule that read the name: exact, or a looser one (alias, trim, fuzzy…). */
              match: z.string(),
              image_path: z.string(),
            })
            .nullable(),
          /** make | model | year | vehicle: what the catalog lacks. */
          reason: z.string().optional(),
          /** Other vehicles close to the entry; never the same car. */
          suggestions: z.array(vehicleSuggestionSchema).optional(),
          search: z.string().optional(),
          error: z.string().optional(),
          /** With views, for a match: how many of the nine views are prepared, which are missing and which prepared ones are verified. */
          views: z.looseObject({ prepared: z.number().int(), missing: z.array(z.string()), verified: z.array(z.string()).optional() }).optional(),
        })
      ),
    }),
    request_id: z.string(),
  }),
  resolve_vehicle: z.looseObject({
    data: z.looseObject({
      /** Ready to pass straight to get_car_image. */
      params: z.looseObject({
        /** Stable id of the resolved vehicle; pass it as `vehicle` to render it again. */
        vehicle_id: z.string().nullable(),
        make: z.string(),
        model: z.string(),
        year: z.number().int(),
        view: z.enum(VIEWS),
        color: z.string(),
      }),
      display: z.looseObject({ make_name: z.string(), model_name: z.string() }).optional(),
      /** Other catalog vehicles that fit the phrase; ask when confidence is low. */
      candidates: z.array(
        z.looseObject({
          make_name: z.string().optional(),
          make_slug: z.string().optional(),
          model_name: z.string().optional(),
          model_slug: z.string().optional(),
          years: z.array(z.number().int()).optional(),
          match_kind: z.string().optional(),
        })
      ),
      /** high | medium | low; confirm with the human before spending on low. */
      confidence: z.enum(["high", "medium", "low"]),
      image_path: z.string().optional(),
      /** The attributes read out of the phrase; nulls are what it did not say. */
      extracted: z.looseObject({}).optional(),
    }),
    /** The equivalent CLI invocation, for a human who wants to repeat it. */
    cli: z.string(),
  }),
  list_image_options: z.looseObject({
    data: z.looseObject({
      views: z.array(
        z.looseObject({
          id: z.enum(VIEWS),
          label: z.string(),
          yaw_degrees: z.number(),
          description: z.string(),
          aliases: z.array(z.string()),
        })
      ),
      colors: z.array(z.looseObject({ name: z.enum(COLORS), hex: z.string() })),
      sizes: z.looseObject({ presets: z.record(z.string(), z.number().int()), max: z.number().int() }),
      formats: z.array(z.enum(FORMATS)),
      pricing: pricingSchema,
      catalog: z.looseObject({
        makes: z.number().int(),
        models: z.number().int(),
        /** [first, last] model year in the catalog. */
        years: z.tuple([z.number().int(), z.number().int()]),
        sources: z.array(z.string()),
      }),
    }),
  }),
  get_pricing: pricingResultSchema,
  search_help: helpResultSchema,
  create_checkout_link: billingLinkResultSchema,
  get_billing_link: billingLinkResultSchema,
  purchase_plan: purchaseResultSchema,
  pay_invoice: purchaseResultSchema,
  checkout_status: checkoutStatusResultSchema,
  get_account: z.looseObject({
    data: z.looseObject({
      organization: organizationSchema.optional(),
      credits: z.number(),
      credits_usd: z.number(),
      auto_reload: z.boolean(),
      has_payment_method: z.boolean(),
      pricing: pricingSchema,
      key: z.looseObject({ id: z.string().optional(), scopes: z.array(z.string()) }).optional(),
    }),
    links: z.record(z.string(), z.string()).optional(),
    request_id: z.string().optional(),
  }),
  list_members: z.looseObject({
    data: z.looseObject({
      organization: organizationSchema,
      members: z.array(z.looseObject({ name: z.string().nullable(), email: z.string().nullable(), role: z.string(), joined_at: z.string() })),
      teams: z.array(
        z.looseObject({
          slug: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          members: z.array(z.looseObject({ name: z.string().nullable(), email: z.string().nullable(), role: z.string() })),
        })
      ),
    }),
    request_id: z.string().optional(),
  }),
  list_webhooks: z.looseObject({
    data: z.array(
      z.looseObject({
        id: z.string(),
        url: z.string(),
        events: z.array(z.string()),
        description: z.string().nullable(),
        status: z.string(),
        disabled_reason: z.string().nullable(),
        consecutive_failures: z.number(),
        last_success_at: z.string().nullable(),
      })
    ),
    limit: z.number().optional(),
    entitlement: z.looseObject({ plan: z.string(), receives: z.unknown() }).optional(),
    request_id: z.string().optional(),
  }),
  report_image: z.looseObject({
    data: z.looseObject({
      object: z.literal("image_report"),
      id: z.string(),
      /** The report's page, private to the reporting account and the Car Image team. */
      url: z.string(),
      type: z.enum(IMAGE_REPORT_TYPES),
      status: z.enum(IMAGE_REPORT_STATUSES),
      flagged: z.boolean(),
      category: z.enum(IMAGE_REPORT_CATEGORIES).nullable(),
      asset_id: z.string().nullable(),
      vehicle: z.looseObject({ make: z.string(), model: z.string(), year: z.number() }),
      external_ref: z.string().nullable().optional(),
      report_count: z.number(),
      created_at: z.string(),
    }),
    /** False when the report folded into the account's open one on the same image (or vehicle). */
    created: z.boolean().optional(),
    request_id: z.string(),
  }),
  decode_vin: z.looseObject({ data: vinResultSchema, request_id: z.string() }),
  create_3d_model: z.looseObject({
    data: model3dSchema,
    billing: z.looseObject({
      charged_on: z.literal("creation"),
      credits_charged: z.number(),
      credits_remaining: z.number(),
      /** True, with credits_charged 0, when the account already owned this vehicle in this color. */
      already_owned: z.boolean(),
    }),
    request_id: z.string(),
  }),
  get_3d_model: z.looseObject({ data: model3dSchema, request_id: z.string() }),
  publish_3d_model: z.looseObject({ data: model3dSchema, request_id: z.string() }),
  list_requests: requestListResult,
  request_vehicle: createdRequestResult,
  request_feature: filedFeedbackResult,
  report_issue: filedFeedbackResult,
  list_feedback: requestListResult,
  list_my_feedback: requestListResult,
  get_feedback: z.looseObject({ data: z.looseObject({ ...requestDetailSchema.shape, timeline: timelineSchema }), request_id: z.string() }),
  upvote_feedback: requestResult,
  remove_feedback_vote: requestResult,
  comment_on_feedback: z.looseObject({ data: requestCommentSchema, request_id: z.string() }),
  submit_review: z.looseObject({ data: publicReviewSchema.extend({ status: z.string(), marketing_consent: z.boolean() }), created: z.boolean(), request_id: z.string() }),
  list_reviews: z.looseObject({ data: z.array(publicReviewSchema), summary: reviewSummarySchema, next_cursor: z.string().nullable(), request_id: z.string() }),
  get_request: z.looseObject({ data: requestDetailSchema, request_id: z.string() }),
  upvote_request: requestResult,
  comment_on_request: z.looseObject({ data: requestCommentSchema, request_id: z.string() }),
  share_building: z.looseObject({
    data: z.looseObject({ building: z.string(), updated_at: z.string() }),
    request_id: z.string(),
  }),
  share_referral: z.looseObject({
    data: z.looseObject({ source: z.enum(REFERRAL_SOURCES), detail: z.string().nullable(), updated_at: z.string() }),
    request_id: z.string(),
  }),
} as const satisfies Partial<Record<McpToolName, z.ZodType>>;

/** The tools that promise structured content, i.e. everything but `describe_api`. */
export type McpToolWithOutput = keyof typeof MCP_TOOL_OUTPUT_SCHEMAS;
export type McpToolOutput<N extends McpToolWithOutput> = z.infer<(typeof MCP_TOOL_OUTPUT_SCHEMAS)[N]>;

/** A catalog hit as either server holds it: the library's camelCase or the REST spelling. */
export interface VehicleMatchSource {
  kind: "make" | "model";
  makeName?: string;
  makeSlug?: string;
  modelName?: string;
  modelSlug?: string;
  vehicleType?: string;
  matchKind?: string;
  make_name?: string;
  make_slug?: string;
  model_name?: string;
  model_slug?: string;
  vehicle_type?: string;
  match_kind?: string;
  years?: number[];
}

/**
 * Normalizes a catalog hit into the one shape `search_vehicles` promises.
 *
 * The remote server reads the catalog library (camelCase) and the stdio one
 * reads `GET /api/v1/vehicles?q=` (snake_case, and it omits `model_name`
 * entirely on a make hit rather than sending null). Agents pass these straight
 * to get_car_image, so both are mapped onto `make`/`model` with explicit nulls.
 */
export function toVehicleMatch(source: VehicleMatchSource): McpToolOutput<"search_vehicles">["data"]["results"][number] {
  return {
    kind: source.kind,
    make: source.makeName ?? source.make_name ?? "",
    make_slug: source.makeSlug ?? source.make_slug ?? "",
    model: source.modelName ?? source.model_name ?? null,
    model_slug: source.modelSlug ?? source.model_slug ?? null,
    vehicle_type: source.vehicleType ?? source.vehicle_type ?? null,
    years: source.years ?? [],
    match_kind: source.matchKind ?? source.match_kind ?? null,
  };
}

function idsOf(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => (typeof value === "string" ? value : String((value as { id?: unknown })?.id ?? ""))).filter(Boolean);
}

/**
 * Normalizes the options payload into the one shape `list_image_options`
 * promises. `GET /api/v1/images/options` describes formats and catalog sources
 * as objects and the year span as `{from, to}`; agents want bare ids and a
 * `[from, to]` pair, so both that shape and an already-flat one are accepted.
 * Anything else in the payload (`limits`, `sizes.source`) rides along untouched.
 */
export function toImageOptions(data: unknown): McpToolOutput<"list_image_options">["data"] {
  const source = (data ?? {}) as Record<string, unknown>;
  const catalog = (source.catalog ?? {}) as Record<string, unknown>;
  const years = catalog.years as [number, number] | { from: number; to: number } | undefined;
  return {
    ...source,
    formats: idsOf(source.formats) as McpToolOutput<"list_image_options">["data"]["formats"],
    catalog: {
      ...catalog,
      years: Array.isArray(years) ? [years[0], years[1]] : [years?.from ?? MIN_YEAR, years?.to ?? MIN_YEAR],
      sources: idsOf(catalog.sources),
    },
  } as McpToolOutput<"list_image_options">["data"];
}

/** What {@link vinSummary} reads: the part of a decoded VIN both servers hold in the same shape. */
export interface VinSummaryInput {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  errors: ReadonlyArray<{ text: string }>;
  vehicle: { id: string; make: string; model: string; year: number } | null;
}

/** The one-line summary both servers put above a decoded VIN. */
export function vinSummary(result: VinSummaryInput): string {
  const car = [result.year ?? "?", result.make ?? "unknown make", result.model ?? "", result.trim ?? ""].filter(Boolean).join(" ");
  const notes = result.errors.length ? ` Decoder notes: ${result.errors.map((error) => error.text).join("; ")}.` : "";
  if (result.vehicle) {
    return `${result.vin}: ${car}. Catalog vehicle ${result.vehicle.id} (${result.vehicle.year} ${result.vehicle.make} ${result.vehicle.model}): pass it as vehicle to get_car_image, create_car_image_urls or create_3d_model.${notes}`;
  }
  return `${result.vin}: ${car}. Not in the image catalog; search_vehicles may find the model under another spelling.${notes}`;
}

/** What {@link model3dSummary} reads: the part of a 3D model both servers hold in the same shape. */
export interface Model3dSummaryInput {
  id: string;
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  stage: string | null;
  vehicle: { make: string; model: string; year: number };
  color: string;
  files: Readonly<Partial<Record<string, { bytes: number }>>> | null;
  error: { message: string; refunded?: boolean; credits_refunded?: number; refunded_at?: string | null; retry?: string } | null;
  estimated_seconds_remaining: number | null;
  /** The hosted side once published: the summary points the agent at the embed. */
  public?: { id: string; url: string; files: unknown; embed: { html: string } } | null;
}

/**
 * What a failed model's summary tells an agent about the credits and the next
 * order, read from the error's fields. The server's `error.retry` sentence is
 * written for REST (POST /api/v1/3d and its Idempotency-Key header); an agent
 * orders through create_3d_model, which costs credits, so it asks the human
 * first, as that tool's description requires. A server without the fields
 * (before OpenAPI 2.40.0) gets the old refund statement.
 */
function model3dRetry(error: Model3dSummaryInput["error"]): string {
  const state =
    error?.refunded === false
      ? "Its refund is pending and has not been posted yet"
      : error?.refunded === true && error.credits_refunded === 0 && !error.refunded_at
        ? "Nothing was charged for it, so there is nothing to refund"
        : error?.credits_refunded
          ? `Its ${error.credits_refunded.toLocaleString("en-US")} credit${error.credits_refunded === 1 ? " was" : "s were"} refunded`
          : "The credits were refunded";
  return `${state}. To try again, confirm with the human, then call create_3d_model again with a new idempotency_key (or none): a fresh attempt, charged like any new order and refunded automatically if it fails; this order's idempotency_key only replays it.`;
}

/** The one-line summary both servers put above a 3D model, with the charge when it was just created. */
export function model3dSummary(model: Model3dSummaryInput, billing?: { credits_charged: number; credits_remaining: number; already_owned?: boolean }): string {
  const car = `${model.vehicle.year} ${model.vehicle.make} ${model.vehicle.model} in ${model.color}`;
  const charge = billing
    ? billing.already_owned
      ? `Already owned: nothing charged, ${billing.credits_remaining.toLocaleString("en-US")} credits remaining. `
      : `Charged ${billing.credits_charged.toLocaleString("en-US")} credits, ${billing.credits_remaining.toLocaleString("en-US")} remaining. `
    : "";
  const hosted = model.public
    ? ` Published as ${model.public.id}: paste public.embed.html into any page (no key), or use public.files for the key-free GLB, USDZ and poster URLs${model.public.files ? "" : ", live once the model is ready"}.`
    : "";
  if (model.status === "ready") {
    const files = Object.entries(model.files ?? {})
      .filter((entry): entry is [string, { bytes: number }] => Boolean(entry[1]))
      .map(([kind, file]) => `${kind} (${(file.bytes / 1_048_576).toFixed(1)} MB)`)
      .join(", ");
    return `${charge}3D model ${model.id} is ready: ${car}; files ${files || "none"}. Each files.<kind>.url redirects to a signed download valid for an hour (the API key is needed on the first hop only).${hosted}`;
  }
  if (model.status === "failed") {
    const imageInstead = (error: unknown) => {
      const url = (error as { image_url?: string } | null | undefined)?.image_url;
      return url ? ` Or request an image of the same vehicle instead (get_car_image; ${url}).` : "";
    };
    return `${charge}3D model ${model.id} failed: ${model.error?.message ?? "the model could not be generated"}. ${model3dRetry(model.error)}${imageInstead(model.error)}`;
  }
  const eta = model.estimated_seconds_remaining === null ? "" : `, about ${model.estimated_seconds_remaining} s left`;
  return `${charge}3D model ${model.id} is ${model.status} (${model.progress}%${model.stage ? `, ${model.stage}` : ""}${eta}): ${car}. Poll get_3d_model(id) again in a few seconds; do not create it twice.${hosted}`;
}

/** The one-line summary both servers put above list_members. */
export function membersSummary(data: { organization: { name: string }; members: readonly unknown[]; teams: readonly unknown[] }): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${data.organization.name}: ${count(data.members.length, "member")}, ${count(data.teams.length, "team")}. Invites, removals and role changes are made on the dashboard by a person.`;
}

/** The one-line summary both servers put above list_webhooks. */
export function webhooksSummary(result: { data: ReadonlyArray<{ status: string }>; entitlement?: { receives: unknown } }): string {
  const active = result.data.filter((endpoint) => endpoint.status === "active").length;
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const receives = result.entitlement && result.entitlement.receives !== "all" ? " This plan receives webhook.test only; image, 3D and upgrade events need a paid plan." : "";
  return `${count(result.data.length, "webhook endpoint")}, ${active} active.${receives} Endpoints are added, tested and deleted by a person on the dashboard or with an API key (REST, SDK or CLI); never claim you changed one.`;
}

/** From this share of a Free month's vehicle images the summaries name the next plan (the server's lib/near-limit-offer.ts). */
export const NEAR_LIMIT_SHARE = 0.8;

/** Below this balance the account summary tells the agent to ask before rendering more. */
export const LOW_BALANCE_CREDITS = 10;

/** What {@link accountSummary} reads: `data` of get_account on both servers, which is `GET /api/v1/account`'s. */
export interface AccountSummaryInput {
  credits: number;
  /** Absent on servers that predate plans. */
  plan?: { name: string; limits: { vehicles_per_month: number | null } } | null;
  pricing?: { credits_per_image?: number; credits_per_dollar?: number } | null;
  /** Usage against the plan's caps; absent on servers before 2026-10-17. Since 2026-10-25 the vehicle-image meter's counts, or the credit meter's distinct vehicles. */
  limits_usage?: {
    meter?: "vehicle_images" | "credits";
    vehicle_images_this_month?: { used: number; limit: number | null } | null;
    /** Free since 2026-11-11: the one allowance per account, courtesy included once granted. */
    vehicle_images_total?: { used: number; limit: number | null } | null;
    distinct_vehicles_this_month?: { used: number; limit: number | null } | null;
  } | null;
  /** The plan one step up; named in the summary from 80% of a Free month. */
  next_plan?: { name: string; price: { monthly: number | null }; checkout_url: string | null } | null;
}

/**
 * The sentence an agent relays once a Free account has used 80% of its free
 * images, one allowance per account since 2026-11-11 (`vehicle_images.upgrade`
 * on image answers, `next_plan` on get_account): what
 * is left and the next plan's Checkout link, which only the human opens.
 */
export function nearLimitSentence(
  upgrade: Pick<NearLimitUpgrade, "state" | "remaining"> & { next_plan: Pick<NearLimitUpgrade["next_plan"], "name" | "checkout_url"> & { price: { monthly: number | null } } },
  /** False where the caller already said the allowance is used up. */
  sayState = true
): string {
  const left = !sayState
    ? ""
    : upgrade.state === "reached"
      ? " The free vehicle images are used up."
      : ` ${upgrade.remaining.toLocaleString("en-US")} free vehicle image${upgrade.remaining === 1 ? "" : "s"} left.`;
  const price = upgrade.next_plan.price.monthly === null ? "" : ` ($${upgrade.next_plan.price.monthly}/month)`;
  return `${left} Tell the human the ${upgrade.next_plan.name} plan${price} includes more: ${upgrade.next_plan.checkout_url} (they open it; never buy it for them).`;
}

/** The one-line summary both servers put above an account: the balance in dollars, the plan, and a stop when it runs low. */
export function accountSummary(data: AccountSummaryInput): string {
  // Free counts one allowance per account (vehicle_images_total); paid plans count the month.
  const total = data.limits_usage?.vehicle_images_total ?? null;
  const images = total ?? data.limits_usage?.vehicle_images_this_month;
  if (data.limits_usage?.meter === "vehicle_images" && images) {
    const period = total ? "free vehicle images used (per account, not per month)" : "vehicle images used this month";
    const kept = total ? "images already received still serve" : "images already received this month still serve";
    const of = (usage: { used: number; limit: number | null }) =>
      `${usage.used.toLocaleString("en-US")} of ${usage.limit === null ? "unlimited" : usage.limit.toLocaleString("en-US")}`;
    const full = (usage: { used: number; limit: number | null } | null | undefined) => Boolean(usage && usage.limit !== null && usage.used >= usage.limit);
    const stop = full(images) ? ` The allowance is used up: ${kept}; ask the human before asking for new ones.` : "";
    const next = data.next_plan;
    const near = data.plan?.name === "Free" && next?.checkout_url && images.limit !== null && images.used >= images.limit * NEAR_LIMIT_SHARE
      ? nearLimitSentence({ state: full(images) ? "reached" : "near", remaining: Math.max(0, images.limit - images.used), next_plan: { name: next.name, price: next.price, checkout_url: next.checkout_url } }, !stop)
      : "";
    return `${data.plan ? `${data.plan.name} plan: ` : ""}${of(images)} ${period}; every image serves as often as needed in any size.${stop}${near}`;
  }
  const perDollar = data.pricing?.credits_per_dollar ?? CREDITS_PER_DOLLAR;
  const perImage = data.pricing?.credits_per_image ?? CREDITS_PER_IMAGE;
  const vehicles = data.plan?.limits.vehicles_per_month ?? null;
  const used = data.limits_usage?.distinct_vehicles_this_month?.used;
  const plan = data.plan
    ? ` on the ${data.plan.name} plan${vehicles === null ? "" : used === undefined ? `, up to ${vehicles.toLocaleString("en-US")} distinct vehicles a month` : `, ${used.toLocaleString("en-US")} of ${vehicles.toLocaleString("en-US")} distinct vehicles used this month`}`
    : "";
  const low = data.credits < LOW_BALANCE_CREDITS ? " Balance is low: ask the human before rendering more." : "";
  return `${data.credits.toLocaleString("en-US")} credits ≈ $${(data.credits / perDollar).toFixed(2)} (${perImage} credit${perImage === 1 ? "" : "s"} per image)${plan}.${low}`;
}

/** What {@link resolveSummary} reads: `data` of resolve_vehicle on both servers, which is `GET /api/v1/images/resolve`'s. */
export interface ResolveSummaryInput {
  params: { vehicle_id?: string | null; make: string; model: string; year: number | string; view: string; color: string };
  display?: { make_name: string; model_name: string } | null;
  confidence: string;
  /** What the phrase itself said; `year` is the year the human asked for, null when they named none. */
  extracted?: { year?: number | null } | null;
}

/**
 * The summary both servers put above a resolved vehicle: which vehicle, the
 * call that renders it, and what needs the human first. A low-confidence
 * match, and a vehicle resolved to another year than the one asked for, are
 * questions for the human, not charges.
 */
export function resolveSummary(data: ResolveSummaryInput): string {
  const make = data.display?.make_name ?? data.params.make;
  const model = data.display?.model_name ?? data.params.model;
  const asked = data.extracted?.year;
  const otherYear =
    typeof asked === "number" && Number(data.params.year) !== asked
      ? ` The human asked for ${asked}: no ${asked} ${model} is in the catalog, so this is the ${data.params.year}. Do not render it yet. That year may file the car under another name: try search_vehicles with the make, the model family and year ${asked}, then tell the human what you found and ask.`
      : "";
  const caution = data.confidence === "low" ? " Confidence is low: confirm with the human before making an image." : "";
  const id = data.params.vehicle_id;
  const render = `how it with get_car_image (in chat; create_car_image_urls for a page, app, email or document, or in a terminal), passing vehicle: "${id}", view: "${data.params.view}" and color: "${data.params.color}".`;
  const next = id ? (otherYear || caution ? ` Once they agree, s${render}` : ` S${render}`) : "";
  return `Resolved to ${make} ${model} ${data.params.year}, view ${data.params.view}, color ${data.params.color} (confidence ${data.confidence}).${otherYear}${caution}${next}`;
}

/** The one-line summary both servers put above a catalog search. */
export function searchSummary(query: string, count: number): string {
  return count
    ? `${count} catalog match${count === 1 ? "" : "es"} for "${query}". Pass a model's vehicle id (id, or ids by year) as vehicle to get_car_image, create_car_image_urls or create_3d_model.`
    : `No catalog match for "${query}". That is not yet a missing vehicle: try resolve_vehicle with the year, make and model, fewer words, or the manufacturer alone.`;
}

/** Explain readiness without making an image request. */
export function imageAvailabilitySummary(data: {
  views: Array<{ view: string; cached: boolean; verified?: boolean; quality: string | null; upgradable?: boolean; upgrade_reason?: string | null; render_eta: { typical_seconds: number } | null }>;
}): string {
  const upgrade = (view: { upgradable?: boolean; upgrade_reason?: string | null }) => !view.upgradable ? ""
    : view.upgrade_reason === "paint_generation" ? ", upgradable (older paint generation)" : ", upgradable (below enhanced quality)";
  return "Free availability check; nothing rendered or queued. " + data.views.map((view) =>
    `${view.view}: ${view.cached ? `prepared (cached)${view.verified ? ", verified" : ""}, ${view.quality ?? "quality unknown"}${upgrade(view)}, serves quickly from storage` : `not prepared; first render ${view.render_eta ? `about ${view.render_eta.typical_seconds} seconds` : "time unavailable"}`}`
  ).join("; ") + ".";
}

/** What {@link checkSummary} reads: the `summary` of check_vehicles on both servers, which is `POST /api/v1/vehicles/check`'s. */
export interface CheckSummaryInput {
  total: number;
  match: number;
  suggestion: number;
  miss: number;
  invalid: number;
  distinct_vehicles: number;
  /** Present when the check read views. */
  views_complete?: number;
  /** Present when the check read views: vehicles whose every prepared view is verified. */
  views_verified?: number;
}

/**
 * The one-line summary both servers put above a vehicle check: the counts, then what to do with each kind of answer.
 * A miss also names the requests page (on `origin`, the hosted server's own), where the human asks for a missing
 * vehicle and gets an email when it is added: `request_vehicle` is not in the core toolset.
 */
export function checkSummary(summary: CheckSummaryInput, origin: string = DEFAULT_BASE_URL): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const counts = [
    plural(summary.match, "match", "matches"),
    plural(summary.suggestion, "suggestion", "suggestions"),
    plural(summary.miss, "miss", "misses"),
    ...(summary.invalid ? [`${summary.invalid} invalid`] : []),
  ].join(", ");
  const next = [
    summary.match ? `Render each match by its vehicle.id (${plural(summary.distinct_vehicles, "distinct vehicle", "distinct vehicles")}).` : "",
    summary.views_complete !== undefined && summary.match
      ? `${summary.views_complete} of ${summary.distinct_vehicles} have all nine views prepared; views.missing names the views of the others that are not prepared yet.`
      : "",
    // Said only when there is something to say: a view that is not verified is never described as a problem.
    summary.views_verified && summary.match
      ? `${plural(summary.views_verified, "vehicle has", "vehicles have")} every prepared view verified; views.verified names each match's verified views.`
      : "",
    summary.suggestion ? "Each suggestion names other vehicles than the one listed: ask the human before using one." : "",
    summary.miss
      ? `Skip each miss in every view and color; the human can request a missing vehicle at ${origin}/requests?ref=mcp and gets an email when it is added.`
      : "",
    summary.invalid ? "Fix the invalid entries (error) and check them again." : "",
  ].filter(Boolean);
  return [`Checked ${plural(summary.total, "vehicle", "vehicles")}: ${counts}.`, ...next].join(" ");
}

/** What {@link imageUrlsSummary} reads: create_car_image_urls' result on both servers, which is `POST /api/v1/image-urls`'s body. */
export interface ImageUrlsSummaryInput {
  data: ReadonlyArray<{ expires_at: string; renews_until?: string | null }>;
  /** The credit meter's charge, or the vehicle-image meter's month (`vehicle_images`). */
  billing: { credits_charged: number; credits_remaining?: number; vehicle_images?: { used: number; included: number | null; upgrade?: NearLimitUpgrade } };
  idempotent_replayed?: boolean;
}

/** The fields needed to display a minted vehicle image without another request. */
export interface ImageMarkdownInput {
  url: string;
  vehicle: { make: string; model: string; year: number | string; view: string; color: string };
}

/** Presentation only: preserve URLs, expiry and billing without minting or fetching an image. */
export function withImageMarkdown<T extends { data: ReadonlyArray<ImageMarkdownInput> }>(
  result: T
): Omit<T, "data"> & { data: Array<T["data"][number] & { markdown: string }> } {
  return {
    ...result,
    data: result.data.map((item) => {
      const { make, model, year, view, color } = item.vehicle;
      const alt = `${year} ${make} ${model}, ${view} view, ${color}`
        .replace(/[\r\n]+/g, " ")
        .replace(/[\\[\]]/g, "\\$&");
      // Angle-delimited destinations allow parentheses; encode delimiters and whitespace.
      const url = item.url.replace(/[<>\s]/g, (character) => encodeURIComponent(character));
      return { ...item, markdown: `![${alt}](<${url}>)` };
    }),
  };
}

export function imageUrlsSummary(result: ImageUrlsSummaryInput): string {
  const count = result.data.length;
  const urls = `${count} signed URL${count === 1 ? "" : "s"}`;
  const images = result.billing.vehicle_images;
  const charged = images
    ? `${images.used.toLocaleString("en-US")} of ${images.included === null ? "unlimited" : images.included.toLocaleString("en-US")} vehicle images used`
    : `${result.billing.credits_charged} credit${result.billing.credits_charged === 1 ? "" : "s"}`;
  const renewsUntil = result.data.find((item) => item.renews_until)?.renews_until ?? null;
  const lifetime = `they expire at ${result.data[0]?.expires_at ?? "the stated time"}${renewsUntil ? ` and renew on load${images ? "" : ", one credit per window,"} until ${renewsUntil}` : ""}`;
  const display = `For chat, paste each markdown image directly in the final reply, outside code fences (or use ![vehicle description](url) for an older result). No key needed; ${lifetime}. Reuse these URLs; do not call another paid image tool to display them.`;
  return result.idempotent_replayed
    ? `Replayed the result stored for this idempotency_key: ${urls}, ${images ? charged : `charged ${charged} the first time and nothing now`}. ${display}`
    : images
      ? `Created ${urls}; ${charged}. Each image serves as often as needed.${images.upgrade ? nearLimitSentence(images.upgrade) : ""} ${display}`
      : `Created ${urls}; charged ${charged}, ${result.billing.credits_remaining} remaining. ${display}`;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition<N extends McpToolName = McpToolName> {
  name: N;
  title: string;
  description: string;
  inputSchema: (typeof MCP_TOOL_SCHEMAS)[N];
  /** What `structuredContent` will hold; absent only on `describe_api`, which answers in prose. */
  outputSchema?: N extends McpToolWithOutput ? (typeof MCP_TOOL_OUTPUT_SCHEMAS)[N] : undefined;
  annotations: McpToolAnnotations;
}

export const MCP_TOOLS: { [N in McpToolName]: McpToolDefinition<N> } = {
  get_pricing: {
    name: "get_pricing", title: "Get current pricing",
    description: "Free, no account needed. The pricing document: every plan's monthly and yearly price, its vehicle images a month (a vehicle image is one vehicle in one color from one angle, delivered as often as needed), included credits (for 3D models, make logos and upgrades; credits are not sold), limits per tier and features, the one-time Image Packs (add_ons), the free tier and live 3D model cost. There is no overage. Every plan and pack has a checkout_url that works before signup (sign-in, then Stripe Checkout; nothing is charged until the human pays): hand it to the human with the price. Use before explaining costs or choosing a plan.",
    inputSchema: MCP_TOOL_SCHEMAS.get_pricing, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_pricing,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  search_help: {
    name: "search_help", title: "Search product help",
    description: "Free. Find source-linked answers about pricing, terms, licensing, manufacturer rights, policies, Enterprise, delivery and account support. Suitable for drafting replies to customer questions. Submit one question at a time without personal information or full emails; queries are recorded privately to improve articles. Cite sources, do not invent missing answers or contract exceptions, and escalate unanswered parts to support.",
    inputSchema: MCP_TOOL_SCHEMAS.search_help, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.search_help,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  create_checkout_link: {
    name: "create_checkout_link", title: "Create a checkout link",
    description: "Free. On the human's request, prepare a Pro or Business subscription purchase link for their own account (credits are not sold; for a one-time set of images, hand them an Image Pack's checkout_url from get_pricing). Never charges a card or switches a plan. A human completes payment in the browser. Connected apps and keys without billing:write receive a checkout link that signs the human in first; existing subscriptions and agreements use the dashboard. Without an account at all, use get_pricing's checkout_url. Return the URL and message; never claim payment succeeded.",
    inputSchema: MCP_TOOL_SCHEMAS.create_checkout_link, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.create_checkout_link,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  get_billing_link: {
    name: "get_billing_link", title: "Open billing settings",
    description: "Free. Get a private Stripe portal link for invoices and payment methods with an owner API key carrying billing:write, or a dashboard sign-in link for connected apps and other keys. Changes are confirmed by the human in the browser. Never share portal URLs publicly.",
    inputSchema: MCP_TOOL_SCHEMAS.get_billing_link, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_billing_link,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  purchase_plan: {
    name: "purchase_plan", title: "Buy a plan with a payment token",
    description: "CHARGES MONEY. Buys Pro or Business for this account with a Stripe Shared Payment Token (spt_…) the agent platform minted from the buyer's card; never a card number. Never call it without a spending mandate or the human's explicit go-ahead: run it with dry_run: true first, tell the human the amount, card and what renews, then call again with the same purchase_id and dry_run false. The owner's monthly agent spending limit (billing.agent_spend in get_account) is enforced on top; with none, or with a key without billing:purchase, it refuses and returns checkout_url to hand the human instead. A token pays once: renewals need a card the owner saves, or pay_invoice with a fresh token.",
    inputSchema: MCP_TOOL_SCHEMAS.purchase_plan, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.purchase_plan,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  pay_invoice: {
    name: "pay_invoice", title: "Pay an open plan invoice with a payment token",
    description: "CHARGES MONEY. Pays an open plan invoice (billing.renewal_due in get_account: a renewal a one-time token could not pay) with a fresh Stripe Shared Payment Token, within the owner's agent spending limit. Dry run first and confirm the amount with the human unless the mandate covers it; same purchase_id to retry. Refusals return checkout_url for the human.",
    inputSchema: MCP_TOOL_SCHEMAS.pay_invoice, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.pay_invoice,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  checkout_status: {
    name: "checkout_status", title: "Check a Checkout session",
    description: "Free. The state of a hosted Checkout session from create_checkout_link (its session_id), for an agent paying in the browser with an agent card or Link: poll every few seconds until complete is true, then call get_account.",
    inputSchema: MCP_TOOL_SCHEMAS.checkout_status, outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.checkout_status,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },

  get_make_logo: {
    name: "get_make_logo",
    title: "Get make logo",
    description: `Generate or fetch a transparent catalog make logo inline. COSTS 1 CREDIT per successful delivery, including cache hits; failures refund. Takes make plus size, width, height, fit, background, trim, padding and format; auto delivers PNG. No model, year, vehicle, view, paint color, custom prompt or signed URL mode. Download through the CLI or SDK for use in a site. Generated logos may be inaccurate: inspect before use. ${MAKE_LOGO_NOTICE}`,
    inputSchema: MCP_TOOL_SCHEMAS.get_make_logo,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_make_logo,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  get_car_image: {
    name: "get_car_image",
    title: "Get car image bytes",
    description:
      `In ChatGPT, use create_car_image_urls for the inline image card instead. In other hosts, show a vehicle in chat: returns the image as an MCP image the host displays inline with the result, and the bytes for a file. Name the vehicle, view and color in the reply; do not also mint a signed URL for the same image. Where the person cannot see tool images (a terminal), use create_car_image_urls instead. Counts one vehicle image (vehicle, color, angle) for the month on the account's plan, prepared yet or not; the same image again this month adds nothing. Legacy credit-meter accounts: COSTS ${CREDITS_PER_IMAGE} CREDIT per call, cached or generated. Call resolve_vehicle first (or search_vehicles, or decode_vin for a VIN) and pass the id it returns as \`vehicle\`: the lookup is free, and the catalog files cars under its own names (a Mazda "MX-5 Miata" is mx-5), so a make and model typed from memory can answer 404 for a car the catalog carries. Make, model and year are for callers that already hold catalog spellings. Nine camera angles, any paint color (fifteen named presets or any hex such as #1a2b3c), any width and height up to the stored image's own size, ${STORED_SIZE_NOTE} (fit contain|cover|inside), transparent or on a solid background, optionally trimmed to the car and with a soft ground shadow (shadow: true). Returns the image (PNG/WebP/JPG; format auto delivers PNG here) plus usage metadata (credits_charged, vehicle_images used this month, or credits_remaining on the credit meter; source cache|generated, request_id, the vehicle with its vehicle_id, verified_on: the UTC day these exact bytes were compared with the manufacturer's material for that model year and matched (verified), or null when not checked, which does not mean wrong). Use create_car_image_urls for web pages, apps, emails and documents, and in a terminal. Do not call both paid tools for one image.`,
    inputSchema: MCP_TOOL_SCHEMAS.get_car_image,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_car_image,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  create_car_image_urls: {
    name: "create_car_image_urls",
    title: "Create signed car image URLs",
    description:
      "Put vehicle images into web pages, apps, emails and documents: create 1-50 key-free signed URLs a browser loads directly (<img src>), each with ready-to-display Markdown. In ChatGPT, use this tool to show the inline image card. In other chat hosts, get_car_image displays the picture inline. For chat use ttl_seconds 604800, max_uses 0 and renewal off unless requested. When ChatGPT shows the card, do not repeat its images or URLs. Without a card, use the returned Markdown where supported or link the same URL. Reuse unexpired URLs; never mint twice for one image. Each URL counts its vehicle image for the month at creation (1 credit on the legacy credit meter); loads within the TTL add nothing and are publicly cacheable. Each image names its vehicle like get_car_image: look each distinct vehicle up once (resolve_vehicle, search_vehicles or decode_vin, all free) and pass its id as vehicle, or send make, model and year in catalog spelling. Each takes any paint color (a preset or a hex) and the same sizing options (width, height, fit, background, framing, trim, padding, shadow); format auto makes the URL serve webp or png per viewer. For email, CMS pages or documents that outlive a TTL, set renew: true with ttl_seconds 604800: the URL keeps serving past expiry, renewing in each opened week (one more credit per week on the legacy credit meter), for up to renew_days. Pass idempotency_key when the call might be repeated: a retry with the same key and arguments replays the first result instead of billing again. Returns id, url, markdown, expires_at, max_uses, renews_until and the normalized vehicle for each image. Prefer this over get_car_image for HTML, Markdown files, documents, emails and websites. State expiry briefly.",
    inputSchema: MCP_TOOL_SCHEMAS.create_car_image_urls,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.create_car_image_urls,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  search_vehicles: {
    name: "search_vehicles",
    title: "Search the vehicle catalog",
    description:
      `Free. Browse the open vehicle catalog (${CATALOG_MAKES} makes, ${CATALOG_MODELS} models, ${CATALOG_YEARS}) by make and/or model with typo tolerance. Returns canonical make/model names, the years each model exists and match kind; a model hit carries a stable vehicle id per year (ids, and id when the query names one year) to pass as \`vehicle\` to the image and 3D tools. Use it to list a make's models, to see which years exist or to let the human choose between similar models; when you already know which car is wanted, resolve_vehicle is the one call that names it.`,
    inputSchema: MCP_TOOL_SCHEMAS.search_vehicles,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.search_vehicles,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  resolve_vehicle: {
    name: "resolve_vehicle",
    title: "Resolve free text to image parameters",
    description:
      'Free. The first call for any picture of a car, including one you chose yourself: turn a request such as "red 2018 Mazda MX-5 Miata side view" into the catalog vehicle and exact get_car_image parameters (vehicle_id, make, model, year, view, color), plus alternative candidates and a confidence of high, medium or low. A make and model are read by the rules the image tools read them with, so this names the vehicle they would render. Pass params.vehicle_id as vehicle to get_car_image, create_car_image_urls or create_3d_model. Ask the human to choose when confidence is low or several candidates fit, and tell them when params.year is not the year they asked for (extracted.year).',
    inputSchema: MCP_TOOL_SCHEMAS.resolve_vehicle,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.resolve_vehicle,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_image_options: {
    name: "list_image_options",
    title: "List image options",
    description:
      "Free. List the supported camera views (with yaw angles and aliases), the fifteen preset colors with hex swatches (any other paint is a hex color), size presets, output formats, current pricing and catalog coverage. Use it when you need to validate or explain what can be requested.",
    inputSchema: MCP_TOOL_SCHEMAS.list_image_options,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_image_options,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_account: {
    name: "get_account",
    title: "Get account",
    description: `Free. Show the organization this connection acts for (data.organization, with the caller's role), usage this month (limits_usage: vehicle images used and included, keys, request rates) and the key's scopes. Every new account includes ${FREE_VEHICLE_IMAGES} free vehicle images, once per account (limits_usage.vehicle_images_total), and ${FREE_COURTESY_VEHICLE_IMAGES} more once they run out. Check this before large batches.`,
    inputSchema: MCP_TOOL_SCHEMAS.get_account,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_account,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_members: {
    name: "list_members",
    title: "List organization members",
    description:
      "Free, read only. List the members of the organization this connection acts for, with their roles (viewer, member, admin, owner), and its teams with their members. Inviting, removing people and changing roles happen on the dashboard, done by a person; never claim you did them.",
    inputSchema: MCP_TOOL_SCHEMAS.list_members,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_members,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_webhooks: {
    name: "list_webhooks",
    title: "List webhook endpoints",
    description:
      "Free, read only. List the account's webhook endpoints: URL, subscribed event types, whether each is active or turned off (and why), its failure streak and last success, plus which events the plan receives. Use it to answer why an integration stopped hearing about images or 3D models. Adding, testing, turning off and deleting endpoints happen on the dashboard or with an API key; never claim you did them.",
    inputSchema: MCP_TOOL_SCHEMAS.list_webhooks,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_webhooks,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  describe_api: {
    name: "describe_api",
    title: "Describe the REST API",
    description:
      "Free. Return a compact reference of the Car Image REST API (methods, paths, parameters, credit costs, response headers, error codes, agent notes) for writing code that calls the API directly, with SDK (`@meterapp/car-image-sdk`) and CLI (`npx @meterapp/car-image`) equivalents. Optional endpoint filter.",
    inputSchema: MCP_TOOL_SCHEMAS.describe_api,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  decode_vin: {
    name: "decode_vin",
    title: "Decode a VIN",
    description:
      `Free. Decode a full 17-character VIN, or a partial VIN of at least 5 characters with * for unknown positions, with NHTSA vPIC data: year, make, model, trim, series, body class, engine, transmission, manufacturer, plant and every decoded attribute. \`vehicle\` is the catalog vehicle it maps to, with the stable id to pass as \`vehicle\` to get_car_image, create_car_image_urls or create_3d_model, or null when the catalog does not carry that car. Use it whenever the human gives a VIN instead of a make and model. To show the vehicle, call create_car_image_urls with that id (1 credit per signed URL, loads at once when the image is already rendered).`,
    inputSchema: MCP_TOOL_SCHEMAS.decode_vin,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.decode_vin,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  get_image_availability: {
    name: "get_image_availability",
    title: "Check prepared images and quality",
    description: "Free, read-only check before generating an image. Look the vehicle up first and pass its vehicle id. Check one view or omit view for all nine; pass the requested paint as color. cached true means the view is prepared: it serves quickly from storage, without waiting for a new render. verified true means the image served for that view was compared with the manufacturer's own material for that model year and matched; false says only that the view has not been verified yet, as most have not, never that it is wrong. Returns each view's quality (standard, enhanced or premium; null when no stored image), its paint_generation against latest_paint_generation, upgrade state (upgradable with upgrade_reason paint_generation or quality: an upgrade redraws the view with the latest paint generation at enhanced quality and stores the new version), and render_eta for views not cached. It renders nothing, queues nothing and counts no image usage. This does not authorize a render or an upgrade. Unlike a public preview, this checks what an authenticated image request would serve, including the requested color.",
    inputSchema: MCP_TOOL_SCHEMAS.get_image_availability,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_image_availability,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  check_vehicles: {
    name: "check_vehicles",
    title: "Check which vehicles the catalog carries",
    description: `Free. Check a list of up to ${MAX_MCP_CHECK_VEHICLES} vehicles in one call before rendering any: which ones the catalog carries and under which vehicle id. Send each as the list spells it ({make, model, year}) or as a stored id ({vehicle}), with an optional ref that is echoed back. Each entry is read exactly as get_car_image would read it and answered as match (vehicle.id is the id to store and render by; vehicle.match is exact, or the looser rule that read the name), suggestion (not in the catalog as named; suggestions are real vehicles close to it, such as the same model in its nearest year, which is another car: ask the human before using one), miss (nothing close: skip it in every view and color) or invalid (error says what to fix). Use it for a catalog, a spreadsheet or any list of more than a few cars, instead of one lookup or one paid render per car; summary counts each status and the distinct vehicles a backfill would render. With views: true each match also carries views.prepared (0-9) and views.missing, which of its nine camera views are prepared now, and views.verified, the prepared views that are verified (a view not listed has not been verified yet, nothing more); summary.views_complete counts the vehicles with all nine prepared and summary.views_verified those whose every prepared view is verified. A longer list is work for code: car-image check <file>, or client.checkVehicles, ${MAX_CHECK_VEHICLES.toLocaleString("en-US")} vehicles per request.`,
    inputSchema: MCP_TOOL_SCHEMAS.check_vehicles,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.check_vehicles,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  create_3d_model: {
    name: "create_3d_model",
    title: "Create a 3D model",
    description:
      `COSTS ${MODEL_3D_PRICE} PER CALL for a vehicle and color the account does not own yet, charged when the request is made whether the model is cached, in progress or new: confirm with the human before creating one. A vehicle and color the account already holds a live request for is owned and free (billing.already_owned true, credits_charged 0). Build a textured 3D model (GLB, USDZ, FBX and a PNG thumbnail, plus glb_web, a smaller browser build) of one catalog vehicle (its vehicle id from resolve_vehicle, search_vehicles or decode_vin, which is the safe way to name it before a charge this size, or make, model and year) in one paint color (a preset or any hex), from the same renders the images use, so it matches the pictures. A failed model is refunded. Returns the request at once with status queued, processing or ready (cached), progress 0-100 and estimated_seconds_remaining; poll get_3d_model every few seconds until status is ready, then hand over files.<kind>.url (API URLs that redirect to short-lived signed downloads), or pass webhook_url to be POSTed the same JSON when it settles. Pass publish: true when the model is for a web page: data.public.embed.html is a two-line, key-free embed hosted by Car Image. The first model takes 10–20 minutes; further colors take 1–2 minutes.`,
    inputSchema: MCP_TOOL_SCHEMAS.create_3d_model,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.create_3d_model,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  get_3d_model: {
    name: "get_3d_model",
    title: "Get a 3D model",
    description:
      "Free. The state of one 3D request by id: status (queued, processing, ready, failed), progress 0-100, stage, estimated_seconds_remaining, the vehicle and color, once ready the files (glb, glb_web, usdz, fbx, thumbnail, paint_mask: a grayscale PNG aligned with the GLB's base-colour texture, white where the texel is paint, to recolour the paint live in your own viewer) with their download URLs, byte sizes and content types, and public (key-free URLs and the embed) when the model is published. Poll it every few seconds after create_3d_model; a processing model is re-checked with the provider on each call. A failed model carries error: refunded says whether its credits came back (false while the refund is pending) and retry how to order again.",
    inputSchema: MCP_TOOL_SCHEMAS.get_3d_model,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_3d_model,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  publish_3d_model: {
    name: "publish_3d_model",
    title: "Publish a 3D model",
    description:
      "Free. Publish one of the account's 3D requests so a web page can show it without an API key: data.public gains an id, key-free URLs for the web GLB, the USDZ and the poster (served from Car Image's CDN) and embed.html, a script tag plus a <car-3d> element to paste into any HTML. Works before the model is ready (the URLs are stable, the files follow). Pass unpublish: true to take it down again; the links stop working within the hour. Idempotent either way.",
    inputSchema: MCP_TOOL_SCHEMAS.publish_3d_model,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.publish_3d_model,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  list_requests: {
    name: "list_requests",
    title: "List vehicle and feature requests",
    description:
      "Free, public. List what people have asked for: vehicles missing from the catalog and feature ideas, with vote and comment counts, status (open, planned, in_progress, done, declined) and a public page URL. Sort by votes or recency, filter by kind or status. Use it before request_vehicle or request_feature to find an existing request to upvote.",
    inputSchema: MCP_TOOL_SCHEMAS.list_requests,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_requests,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  request_vehicle: {
    name: "request_vehicle",
    title: "Request a missing vehicle",
    description:
      "Free. Ask for a vehicle that search_vehicles/resolve_vehicle cannot find. If an open request for the same make, model and year already exists it is upvoted instead and returned with deduplicated: true, so calling this is always safe. The requester's vote counts, and the human gets a short thank-you email with the request page.",
    inputSchema: MCP_TOOL_SCHEMAS.request_vehicle,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.request_vehicle,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  request_feature: {
    name: "request_feature",
    title: "Request a feature",
    description:
      "Free. When the human wishes the API did something it does not (new views, formats, endpoints, anything), file it on the public feedback board. Similar items are checked first: when some exist nothing is filed (created: false) and similar lists them; upvote_feedback the one that matches, or call again with force: true if none does. A new request returns its page URL; the human gets a thank-you email and one for every status change until it ships.",
    inputSchema: MCP_TOOL_SCHEMAS.request_feature,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.request_feature,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  report_issue: {
    name: "report_issue",
    title: "Report an issue",
    description:
      "Free. Report a problem with Car Image itself (a failed or wrong render, an error that looks like a bug, a broken endpoint), with the human's agreement. Pass the failed call's request_id and what you know in context (endpoint, error_code, vehicle id, view, color): the team sees exactly what happened. Private to the human and the team. Similar open reports come back first, as with request_feature: upvote_feedback one that matches. The human gets an acknowledgement and an email when it is picked up and when it is fixed. Not for a vehicle the catalog lacks, and never include API keys.",
    inputSchema: MCP_TOOL_SCHEMAS.report_issue,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.report_issue,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  report_image: {
    name: "report_image",
    title: "Report an image or a missing vehicle",
    description:
      "Free. Use it when the human says a picture is the wrong car, generation, angle or paint (type wrong_image), is poorly drawn (poor_quality), or that a vehicle is missing from the catalog (missing_vehicle: make, model and year only). Name the image by request_id or asset_id when you have one, else by vehicle with view and color. One call files a tracked report and starts the fix: reports from enough accounts take the image out of service while it is redrawn; a missing vehicle joins the catalog request. A repeat on the same image folds into the open report (created: false, same id). Show the human the report's url, a page private to their account, and keep its id. No personal data in reason or external_ref. Not for API errors: that is report_issue.",
    inputSchema: MCP_TOOL_SCHEMAS.report_image,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.report_image,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  list_feedback: {
    name: "list_feedback",
    title: "List the feedback board",
    description:
      "Free, public. The feedback board: feature requests, vehicle requests and published issues, with votes, comments, status (open, planned, in_progress, done, declined, duplicate) and a page URL. Search with q, filter by kind or status, sort by top, new or recent_activity.",
    inputSchema: MCP_TOOL_SCHEMAS.list_feedback,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_feedback,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  get_feedback: {
    name: "get_feedback",
    title: "Get a feedback item",
    description: "Free. One item with its comments (official: true marks the team's responses) and its timeline of status changes. A private issue is readable by its reporter only, with the context it was filed with.",
    inputSchema: MCP_TOOL_SCHEMAS.get_feedback,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_feedback,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_my_feedback: {
    name: "list_my_feedback",
    title: "List my feedback",
    description: "Free. What the human filed (private issues included) and what they vote on, comment on or follow, any status: use it to tell them where their requests and reports stand.",
    inputSchema: MCP_TOOL_SCHEMAS.list_my_feedback,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_my_feedback,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  upvote_feedback: {
    name: "upvote_feedback",
    title: "Upvote a feedback item",
    description: "Free. Add the human's vote to a feature, vehicle request or published issue (idempotent): the way to say \"me too\" instead of filing a duplicate. They follow it from then on and hear about every status change. A vote on a merged item lands on the item it was merged into.",
    inputSchema: MCP_TOOL_SCHEMAS.upvote_feedback,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.upvote_feedback,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  remove_feedback_vote: {
    name: "remove_feedback_vote",
    title: "Remove a vote",
    description: "Free. Remove the human's vote from an item (idempotent); they stop following it unless they commented.",
    inputSchema: MCP_TOOL_SCHEMAS.remove_feedback_vote,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.remove_feedback_vote,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  comment_on_feedback: {
    name: "comment_on_feedback",
    title: "Comment on a feedback item",
    description: "Free. Add a comment to an item, e.g. the use case or detail that matters; shown with the human's first name only.",
    inputSchema: MCP_TOOL_SCHEMAS.comment_on_feedback,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.comment_on_feedback,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  submit_review: {
    name: "submit_review",
    title: "Review Car Image",
    description:
      "Free. Post or edit the human's public review of Car Image (one per account, 1-5 stars, their own words; never invent or nudge a rating). Shown on the reviews page with the team's answer once it passes a quick check. Set marketing_consent only when they agree to be quoted. Editing replaces the displayed public review; confirm the replacement text with the human. One edit an hour; the first post gets a thank-you email.",
    inputSchema: MCP_TOOL_SCHEMAS.submit_review,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.submit_review,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  list_reviews: {
    name: "list_reviews",
    title: "List reviews",
    description: "Free, public. Published reviews of Car Image with the team's responses, plus the average rating and the 1-5 distribution.",
    inputSchema: MCP_TOOL_SCHEMAS.list_reviews,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.list_reviews,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  get_request: {
    name: "get_request",
    title: "Get a request",
    description: "Free, public. One request with its full comment thread, vote count and status.",
    inputSchema: MCP_TOOL_SCHEMAS.get_request,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.get_request,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  upvote_request: {
    name: "upvote_request",
    title: "Upvote a request",
    description: "Free. Add the caller's vote to a request (idempotent; voting twice changes nothing). Returns the updated request.",
    inputSchema: MCP_TOOL_SCHEMAS.upvote_request,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.upvote_request,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  comment_on_request: {
    name: "comment_on_request",
    title: "Comment on a request",
    description: "Free. Add a public comment to a request, e.g. the body style or use case that matters. Comments show the author's first name only.",
    inputSchema: MCP_TOOL_SCHEMAS.comment_on_request,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.comment_on_request,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  share_building: {
    name: "share_building",
    title: "Tell us what you are building",
    description:
      "Free. Record what the human is building with the API. Private to the Car Image team (never shown publicly); re-sharing overwrites the previous answer. Only call it with the human's own words and consent.",
    inputSchema: MCP_TOOL_SCHEMAS.share_building,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.share_building,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  share_referral: {
    name: "share_referral",
    title: "Tell us how you found us",
    description:
      "Free. Record where the human first heard about Car Image API (one of a fixed list of sources, plus optional detail). Private to the Car Image team; re-sharing overwrites. Only call it with the human's consent.",
    inputSchema: MCP_TOOL_SCHEMAS.share_referral,
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS.share_referral,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
};

export const MCP_TOOL_LIST: McpToolDefinition[] = Object.values(MCP_TOOLS) as McpToolDefinition[];

export interface ApiEndpointReference {
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  auth: "bearer" | "public";
  credits: string;
  params?: string[];
  returns?: string;
  errors?: string[];
  notes?: string;
  sdk?: string;
  cli?: string;
}

/** Compact, hand-maintained mirror of /openapi.json for agents that cannot fetch it. */
export const API_REFERENCE: ApiEndpointReference[] = [
  {
    method: "GET", path: "/api/v1/images/logo", auth: "bearer", credits: "1 credit per delivered logo, including cache hits",
    summary: "Prompt-generated catalog make logo. Third-party trademarks, referential display only; no license or VehiclesDB indemnity. See /terms#logos.",
    params: ["make (required catalog make name or slug)", "size (thumb|small|medium|large)", "w, h (1–1024)", "fit (contain|cover|inside)", "background (transparent|white|black|hex)", "trim (1), padding (0–50, with trim)", "format (png|webp|jpg|auto)"],
    sdk: "client.getMakeLogo({ make: 'toyota', width: 256 })",
    cli: "car-image logo --make Toyota --width 256 --out toyota-logo.png",
    returns: "Image bytes with X-Credits-Charged, X-Credits-Remaining, X-Image-Source, X-Image-Width, X-Image-Height, ETag and X-Request-Id. Failed delivery refunds the credit. No signed URL or 304 mode.",
  },
  { method: "GET", path: "/api/v1/pricing", summary: "The pricing document: plans (price, vehicle images a month, included credits, limits, features, checkout_url), the one-time Image Packs (add_ons), free tier, live 3D cost and how to buy. No overage; credits are not sold.", auth: "public", credits: "free", notes: "Every checkout_url works before signup: sign-in, then Stripe Checkout; nothing is charged until the human pays.", sdk: "client.pricing()", cli: "car-image pricing [--json]" },
  { method: "POST", path: "/api/v1/help", summary: "Source-linked product help and private query recording.", auth: "bearer", credits: "free (account:read)", params: ["query (2-1000 characters, no secrets or personal information)", "report_gap (optional boolean: flag missing context)"], notes: "Related articles are not an answer to every clause. Cite relevant sources; escalate unknowns to support. Queries are recorded privately.", sdk: "client.searchHelp(question, {reportGap: true})", cli: "car-image support question --report-gap" },
  { method: "POST", path: "/api/v1/billing/link", summary: "Link-only checkout or billing settings; never charges or switches a plan.", auth: "bearer", credits: "free (account:read; owner billing:write for Stripe links)", params: ["plan (pro|business) + optional interval (month|year); {} for settings. Credits are not sold"], notes: "Connected apps and keys without billing:write get a checkout link that signs the human in first; existing subscriptions use the signed-in dashboard. A human completes payment in the browser.", sdk: "client.createCheckoutLink({plan: 'pro'}) / client.getBillingLink()", cli: "car-image upgrade --plan pro --no-browser (works before sign-in)" },

  {
    method: "GET",
    path: "/api/v1/images/car",
    summary: "Get a vehicle image (bytes, or a signed URL with Accept: application/json).",
    auth: "bearer",
    credits: "0 on a plan: counts one vehicle image (vehicle, color, angle) for the UTC month, prepared yet or not; the same image again this month adds nothing. Legacy credit meter: 1 per call (cached or generated)",
    params: [
      "make (required unless vehicle is given)",
      "model (required unless vehicle is given)",
      `year (required unless vehicle is given, ${CATALOG_YEARS})`,
      "vehicle (a stable vehicle id such as veh_395yw8tn73ff8, from /api/v1/vehicles, /api/v1/vin or resolve; replaces make, model and year, never alongside them)",
      `view (${VIEWS.join("|")}; default front-3-4)`,
      `color (${COLORS.join("|")}, or any hex paint written bare in URLs such as 1a2b3c; default silver; JSON echoes a hex as #1a2b3c)`,
      "size (thumb=256|small=512|medium=768|large=1024)",
      `w, h (1 or more px, delivered up to the stored image's own size, ${STORED_SIZE_NOTE}; both -> the output is exactly w x h)`,
      `aspect_ratio (${ASPECT_RATIOS.join("|")}; a preset for the box, natural = the car's trimmed shape; w or h complete it, both win; never with size)`,
      `resolution (${RESOLUTION_NAMES.join("|")}: longer side ${Object.values(RESOLUTIONS).join("/")} px, clamped to the stored image; w or h win; never with size)`,
      `fit (${FITS.join("|")}; default contain; only matters with both w and h)`,
      "background (transparent default; white|black|hex such as f4f4f4; jpg defaults to white)",
      `framing (${FRAMINGS.join("|")}; a preset, never with trim or padding: tight = trim=1, balanced = trim=1&padding=6, consistent = one apparent scale across the vehicle's views, the default)`,
      `trim (1 crops to the car's alpha bounds before sizing), padding (0-${MAX_PADDING_PERCENT} percent of the longer side: around the car with trim, around the stored frame without it)`,
      "shadow (1 adds a soft ground shadow under the car, from its cut-out; same image, nothing extra)",
      `format (${FORMATS.join("|")}|auto; default png; auto negotiates webp/png from Accept)`,
      "market (optional; the market of sale as an ISO 3166-1 alpha-2 code such as AU, any case; the account's default market when omitted; never part of what the image is: the same vehicle, color and view is one image and one counted vehicle image under any market)",
    ],
    returns:
      "image bytes; headers X-Credits-Charged (0 on a plan), X-Vehicle-Images-Used, X-Vehicle-Images-Included (a number or unlimited; X-Credits-Remaining instead on the legacy credit meter), X-Image-Source (cache|generated), X-Image-Width, X-Image-Height, X-Vehicle-Appearance (default, or default; market=AU: which appearance was served, the default one for every market today), X-Image-Verified (YYYY-MM-DD the exact bytes were compared with the manufacturer's material for that model year and matched; absent when not checked, which does not mean wrong), ETag, X-Request-Id (Vary: Accept with format=auto). With Accept: application/json: {data:{url,expires_at,vehicle:{vehicle_id,make,model,year,view,color,…},width,height,format,appearance:{market,scope}}, billing:{credits_charged:0, vehicle_images:{used,included}} (credit meter: {credits_charged,credits_remaining}), request_id}",
    errors: ["400 invalid params (also vehicle together with make/model/year)", "401 missing/invalid key", "402 plan_image_limit (used, included, requested, resets_at, pack_url, checkout_url; nothing charged; legacy credit meter: insufficient credits)", "404 vehicle not in catalog or unknown vehicle id", "429 rate limited (Retry-After)", "502 render failed (refunded)", "503 generation_at_capacity: new renders resume at reset_at (Retry-After; nothing charged)"],
    notes: "On 402 stop: images already received this month keep serving; hand the human checkout_url (a higher plan) with the price, or pack_url (Image Packs); buy only when they ask or a spending mandate they set covers it. Respect Retry-After on 429.",
    sdk: "client.getImage({ make, model, year, view, color, size, width, height, aspectRatio, resolution, fit, background, framing, trim, padding, shadow, format, market }) / client.getImage({ vehicle: 'veh_…', color: '#1a2b3c' }) / client.getImageUrl(...)",
    cli: "car-image get --make Porsche --model 911 --year 2024 --view side --color red --out car.png · car-image get --vehicle veh_395yw8tn73ff8 --color 1a2b3c [--market AU]",
  },
  {
    method: "POST",
    path: "/api/v1/image-urls",
    summary: "Create 1-50 signed delivery URLs for browsers (no key needed to load them).",
    auth: "bearer",
    credits: "0 on a plan: each URL counts its vehicle image for the month at creation; loads and renewals add nothing. Legacy credit meter: 1 per URL at creation, 1 per renewed window",
    params: ["images: [{make, model, year | vehicle, view?, color? (preset or hex), size?, width?, height?, fit?, background?, framing?, trim?, padding?, shadow?, format?, market?}] (or a single image object)", "market (optional; the market of sale for every image that names none: an ISO 3166-1 alpha-2 code; the account's default when omitted; not part of the URL or of what is counted)", "ttl_seconds (60-604800; default 3600)", "max_uses (0-1000; 0 = unlimited; default 0)", "renew (auto-renew past the TTL; requires max_uses 0)", "renew_days (1-365; default 365)", "header Idempotency-Key (optional; a retry with the same key and body replays the first response instead of billing again)"],
    returns: "201 {data:[{id,url,expires_at,max_uses,renews_until,vehicle:{vehicle_id,…},appearance:{market,scope}}], billing:{charged_on:'creation',credits_charged:0,vehicle_images:{used,included},renewal?} (credit meter: credits_charged,credits_remaining,credits_per_url), request_id}; a replay carries Idempotent-Replayed: true",
    errors: ["400 invalid body or batch > 50", "401", "402 plan_image_limit (nothing counted)", "404 vehicle not in catalog", "409 same Idempotency-Key still in flight", "422 same Idempotency-Key with a different body", "429"],
    sdk: "client.createImageUrls([{ make, model, year, ...sizing }, { vehicle: 'veh_…' }], { ttlSeconds, maxUses, renew, renewDays, idempotencyKey, market })",
    cli: "car-image url --make BMW --model M3 --year 2022 --ttl 86400 [--renew] [--idempotency-key <key>] [--market DE]",
  },
  {
    method: "POST",
    path: "/api/v1/images/availability",
    summary: "Check up to 200 images before asking for them: whether each vehicle view is prepared (every color of it serves now), whether it would count a vehicle image this month (a view not prepared yet counts as one like any other), and whether the list fits the plan. Each answer also says whether the prepared image is verified (compared with the manufacturer's own material for that model year, and matched; false says only that it has not been verified yet). Read-only: renders, queues and counts nothing. GET with one vehicle's query lists its views, whether each is prepared and verified, their quality and how long the rest take.",
    auth: "bearer",
    credits: "free",
    params: ["images: [{vehicle | make, model, year, view?, color?, market?, …}] (1-200 image objects, as POST /api/v1/image-urls takes)", "market (optional; the market of sale the list is for; GET takes it as a query parameter)"],
    returns: "200 {data:{object:'image_availability_check', images:[{index,prepared,verified,counts_image,vehicle:{id,make,model,year},view,color,appearance:{market,scope}}], summary:{items,prepared,not_prepared,verified}, allowance:{period:{month_start}, vehicle_images:{used,included,would_add,fits}}|null}, request_id}",
    errors: ["400 invalid_body or invalid_params (index)", "401", "404 vehicle_not_found (index)"],
    sdk: "client.checkAvailability([{ vehicle: 'veh_…', view: 'front', color: 'red' }], { market })",
  },
  {
    method: "GET",
    path: "/api/v1/delivery/{token}",
    summary: "Redeem a signed URL; public within its TTL and max_uses. An auto-renewing URL loaded after its TTL renews for a new window on first load (1 credit on the legacy credit meter).",
    auth: "public",
    credits: "free; legacy credit meter: 1 per new window of a renewable URL",
    returns: "image bytes with public Cache-Control for the remaining window",
    errors: ["403 expired, revoked or invalid token", "402 renewal unpaid (legacy credit meter; resumes once the account subscribes)", "410 exhausted"],
  },
  {
    method: "GET",
    path: "/api/v1/images/options",
    summary: "Views, colors, sizes, formats, pricing and catalog coverage.",
    auth: "public",
    credits: "free",
    returns: "{data:{views:[{id,label,yaw_degrees,description,aliases}], colors:[{name,hex}], paint:{parameter,custom,example}, sizes:{presets,max,source}, fits, default_fit, framings, default_framing, backgrounds, trim, formats, pricing:{credits_per_image (0 on a plan),free_credits,plans}, catalog:{makes,models,years,sources}, vehicle_ids:{description,example,lookup,parameter}}}",
    sdk: "client.options()",
    cli: "car-image options",
  },
  {
    method: "POST",
    path: "/api/v1/images/resolve",
    summary: "Resolve free text to exact image parameters.",
    auth: "bearer",
    credits: "free",
    params: ['query: "red 2024 porsche 911 side view"', "market (optional; the market of sale as an ISO 3166-1 alpha-2 code; the account's default when omitted)"],
    returns: "{data:{params:{vehicle_id,make,model,year,view,color}, display:{make_name,model_name}, candidates:[...], confidence:high|medium|low, image_path, appearance:{market,scope}}}",
    sdk: "client.resolve(query, { market })",
    cli: "car-image resolve red 2024 porsche 911 side view [--market AU]",
  },
  {
    method: "POST",
    path: "/api/v1/images/reports",
    summary: "Report a wrong image (the wrong car, generation, angle or paint), a poor image, or a vehicle the catalog lacks. One tracked report that starts the fix: open reports from 2 accounts take an image out of service while it is redrawn; a missing vehicle joins the catalog request. A repeat from the same account on the same image (or vehicle) folds into the open report.",
    auth: "bearer",
    credits: "free (5,000 reports a day per account)",
    params: [
      "type (wrong_image|poor_quality|missing_vehicle; default poor_quality for category quality, else wrong_image)",
      "category (identity|camera|paint for wrong_image, default identity; quality for poor_quality)",
      "an image: asset_id | request_id (the X-Request-Id that delivered it) | vehicle or make+model+year with view?, color?",
      "missing_vehicle: make, model, year only",
      "reason? (≤500), external_ref? (≤100, your own id; returned in webhooks)",
    ],
    returns: "201 {data:{object:'image_report', id, url, type, status (reported|flagged|repaired|closed), flagged, category, asset_id, vehicle:{make,model,year}, view, color, reason, external_ref, report_count, created_at}, created:true, request_id}; 200 with created:false when folded",
    errors: ["400 invalid_body (unknown field, missing target)", "401", "404 (no such image or vehicle id)", "429 (daily report limit)"],
    notes: "Prefer request_id or asset_id. url is the report's page, private to the account. image.issue_reported / image.issue_resolved (and vehicle.available) webhooks carry report_id and external_ref to the reporting account only.",
    sdk: "client.reportImage({ requestId, category: 'identity', reason }) / client.reportImage({ type: 'missing_vehicle', make, model, year })",
    cli: "car-image feedback report-image --request-id <id> --category identity | car-image feedback report-image --type missing_vehicle --make … --model … --year …",
  },
  {
    method: "GET",
    path: "/api/v1/images/reports/{id}",
    summary: "One of your image reports with its status now; another account's is a 404.",
    auth: "bearer",
    credits: "free",
    returns: "200 {data:{object:'image_report', …}, request_id}",
    errors: ["401", "404"],
    sdk: "client.getImageReport(id)",
    cli: "car-image feedback report-image show <id>",
  },
  {
    method: "GET",
    path: "/api/v1/vehicles",
    summary: "Browse or search the catalog; every model in a known year carries its stable vehicle id.",
    auth: "public",
    credits: "free",
    params: ["(none) -> years", "year -> makes [{id,name,slug}]", "year + makeId -> models [{name,slug,vehicle_type,id}]", "make (slug) [+ year] -> that make's models", "make + model (slugs) -> the model's years, each with its id", "q (+ limit, year) -> fuzzy search results; a model hit carries ids {year: id} and id for the year the query named"],
    returns: "{data:{years}} | {data:{year,makes}} | {data:{year,make_id,models}} | {data:{make,models}} | {data:{make,model,years,year_ranges,vehicles:[{year,id}]}} | {data:{query,results:[{kind,make_name,make_slug,model_name,model_slug,vehicle_type,years,year_ranges,match_kind,id?,ids?}]}}",
    sdk: "client.vehicles({ year, makeId }) / client.vehicles({ make, model }) / client.searchVehicles(q, { limit, year })",
    cli: "car-image search porsche 911",
  },
  {
    method: "GET",
    path: "/api/v1/vehicles/{id}",
    summary: "The catalog vehicle a stable id names, with its years and the image URLs that render it.",
    auth: "public",
    credits: "free",
    returns: "{data:{id, make:{id,name,slug}, model:{name,slug,vehicle_type}, year, years, year_ranges, image_path, images:{front,front-3-4,side,rear-3-4,rear,rear-3-4-right,side-right,front-3-4-right,top}}, request_id}",
    errors: ["400 not a vehicle id", "404 unknown id"],
    notes: "Ids are a pure function of the catalog spelling and never change; store them instead of make/model/year strings.",
    sdk: "client.vehicle('veh_395yw8tn73ff8')",
    cli: "car-image get --vehicle veh_395yw8tn73ff8",
  },
  {
    method: "POST",
    path: "/api/v1/vehicles/check",
    summary: "Check which of a list of vehicles the catalog carries, each read the way the image endpoints read it, and get the ids to render by.",
    auth: "bearer",
    credits: "free (10 checks a minute per account)",
    params: [
      `vehicles: 1-${MAX_CHECK_VEHICLES.toLocaleString("en-US")} entries, each {make, model, year} as your data spells them or {vehicle} (a stored id), plus an optional ref (string or number) echoed back; other fields are ignored`,
      `views: optional boolean; true adds each match's views (prepared 0-9, missing view names, verified view names) and summary.views_complete and views_verified, at most ${MAX_CHECK_VIEWS_VEHICLES} entries`,
      "market: optional; the market of sale the list is for (an ISO 3166-1 alpha-2 code; the account's default when omitted); an entry may carry its own market",
    ],
    returns: "{data:{appearance:{market,scope}, summary:{total,match,suggestion,miss,invalid,distinct_vehicles,views_complete?,views_verified?}, results:[{index, ref?, status:match|suggestion|miss|invalid, vehicle:{id,make,make_name,model,model_name,year,match,image_path}|null, reason?:make|model|year|vehicle, suggestions?:[{make,make_name,model,model_name,year,id,image_path}], search?, error?, views?:{prepared,missing,verified}}]}, request_id}",
    errors: [`400 not a list of vehicles, or more than ${MAX_CHECK_VEHICLES.toLocaleString("en-US")} entries (${MAX_CHECK_VIEWS_VEHICLES} with views)`, "401", "413 body over 1 MiB", "429 more than 10 checks a minute (Retry-After)"],
    notes: "Store each match's vehicle.id and render by vehicle=<id> in every view and color. A suggestion is another vehicle (the same model in its nearest year, a related model): never substitute it silently. Skip a miss in every view and color, and check misses again after catalog releases. A bad entry is answered as invalid on its own; it never fails the list.",
    sdk: "client.checkVehicles([{ make, model, year, ref }, { vehicle }], { views, market, batchSize, onProgress }) (splits any length)",
    cli: "car-image check vehicles.csv [--views] [--market AU] --out checked.csv",
  },
  {
    method: "GET",
    path: "/api/v1/vin/{vin}",
    summary: "Decode a full or partial VIN (NHTSA vPIC) and name the catalog vehicle it maps to.",
    auth: "bearer",
    credits: "free",
    params: ["vin in the path: 17 characters, or a partial VIN of 5+ characters with * for each unknown position (case, spaces and dashes ignored)", "year (optional model-year hint)"],
    returns: "{data:{vin, valid, errors:[{code,text}], suggested_vin, year, make, model, trim, series, body_class, vehicle_type, doors, drive_type, fuel_type, engine:{cylinders,displacement_l,hp,model}, transmission:{style,speeds}, manufacturer, plant:{city,state,country}, gvwr, attributes:{…every decoded variable}, vehicle:{id,make,model,year,image_path}|null, source:vpic-db|vpic-api}, request_id}",
    errors: ["400 invalid VIN or year", "401", "404 VIN not recognized", "502 both decoders unavailable"],
    notes: "vehicle.id is a stable vehicle id: pass it as vehicle= to /api/v1/images/car, /api/v1/image-urls or /api/v1/3d. vehicle is null when the catalog does not carry the car.",
    sdk: "client.decodeVin('1HGCM82633A004352', { year: 2003 })",
    cli: "car-image vin 1HGCM82633A004352",
  },
  {
    method: "POST",
    path: "/api/v1/3d",
    summary: "Create a textured 3D model (GLB, USDZ, FBX and a thumbnail) of one vehicle in one paint color.",
    auth: "bearer",
    credits: `${MODEL_3D_PRICE} per model (credits_per_model, reported by GET /api/v1/3d), charged at creation whether the model is cached, in progress or new -- free when the account already holds a live request for the same vehicle and color (billing.already_owned); a failed model is refunded; polls, downloads and publishing are free`,
    params: ["make, model, year — or vehicle (a veh_… id), never both", "color (preset or hex such as #1a2b3c; default silver)", "webhook_url (https, public host; receives one POST {event:'3d_model.ready'|'3d_model.failed', data, sent_at} with X-CarImage-Event and X-CarImage-Delivery, retried up to five times)", "webhook_secret (with webhook_url: X-CarImage-Signature: sha256=<hex HMAC of the raw body>)", "publish (true: key-free URLs and an embed at once, see /api/v1/3d/{id}/publish)", "header Idempotency-Key (optional; same rules as /api/v1/image-urls)"],
    returns: "202 while queued or processing, 200 when already ready: {data:{id, object:'3d_model', status:queued|processing|ready|failed, progress:0-100, stage, vehicle:{id,make,model,year}, color, generator, files:{glb|glb_web|usdz|fbx|thumbnail|paint_mask:{url,bytes,content_type}}|null, polycount, error, estimated_seconds_remaining, webhook, public:{id,url,files,embed:{script,html},published_at}|null, created_at, updated_at, ready_at}, billing:{charged_on:'creation',credits_charged,credits_remaining,already_owned}, request_id}; Location: /api/v1/3d/{id}",
    errors: ["400 invalid body or webhook URL", "401", "402 insufficient credits", "404 vehicle not in catalog", "409/422 Idempotency-Key conflicts", "503 3D models disabled or at daily capacity (Retry-After; nothing charged)"],
    notes: "Ask the human before spending. The first model takes 10–20 minutes; further colors take 1–2 minutes: poll GET /api/v1/3d/{id} every few seconds or use the webhook; never re-POST to check progress. Ordering a vehicle and color the account already owns is free, so re-ordering is safe.",
    sdk: "client.create3dModel({ make, model, year } | { vehicle }, { color, webhookUrl, webhookSecret, publish, idempotencyKey }) then client.wait3dModel(id)",
    cli: "car-image 3d create --make Toyota --model Camry --year 2025 --color 1a2b3c --publish --wait --out ./models",
  },
  {
    method: "POST",
    path: "/api/v1/3d/{id}/publish",
    summary: "Publish one of your 3D requests: key-free URLs and a two-line embed, hosted by Car Image. DELETE unpublishes.",
    auth: "bearer",
    credits: "free",
    returns: "{data: 3d_model with public:{id:'m3d_…', url, files:{glb,usdz,poster:{url,bytes,content_type}}|null (null until ready), embed:{script,html}, published_at}, request_id}; DELETE answers the same with public: null",
    errors: ["404 unknown id (ids are scoped to the account)", "409 the model failed (nothing to publish)"],
    notes: "Paste public.embed.html into any page: <script src=…/embed/3d.js async></script> and <car-3d model=\"m3d_…\"></car-3d>. No key in the page; the files are served from the CDN. Unpublished links stop working within the hour.",
    sdk: "client.publish3dModel(id) / client.unpublish3dModel(id)",
    cli: "car-image 3d publish <id> [--unpublish]",
  },
  {
    method: "GET",
    path: "/api/v1/3d/public/{public_id}",
    summary: "A published model for anyone holding its public id: status, vehicle name, color, key-free file URLs and embed snippets.",
    auth: "public",
    credits: "free",
    returns: "{data:{id, object:'3d_model_public', status, progress, estimated_seconds_remaining, vehicle:{id,make,model,year,name}, color, color_hex, front_theta, alt, files:{glb,usdz?,poster?}|null, embed:{script,html,model_viewer}, published_at, updated_at}, request_id}. /model.glb, /model.usdz and /poster.png under the same path answer 302 to the CDN copy.",
    errors: ["404 unknown or unpublished id", "409 a file asked for before the model is ready (Retry-After)"],
    notes: "CORS *; cacheable. This is what the embed script reads; nothing here names the account.",
  },
  {
    method: "GET",
    path: "/api/v1/3d",
    summary: "The caller's recent 3D requests, newest first, with the current price per model.",
    auth: "bearer",
    credits: "free",
    params: ["limit (1-50; default 20)"],
    returns: "{data:[3d_model…], pricing:{credits_per_model}, request_id}",
    sdk: "client.list3dModels({ limit: 20 })",
    cli: "car-image 3d list",
  },
  {
    method: "GET",
    path: "/api/v1/3d/{id}",
    summary: "Status, progress and files of one 3D request; a processing model is re-checked with the provider.",
    auth: "bearer",
    credits: "free",
    returns: "{data: 3d_model, request_id}",
    errors: ["404 unknown id (ids are scoped to the account)"],
    sdk: "client.get3dModel(id) / client.wait3dModel(id, { intervalMs, timeoutMs, onProgress })",
    cli: "car-image 3d get <id> --wait",
  },
  {
    method: "GET",
    path: "/api/v1/3d/{id}/files/{kind}",
    summary: `One file of a ready model (kind: ${MODEL_3D_FILE_KINDS.join("|")}): a 302 to a signed URL valid for an hour.`,
    auth: "bearer",
    credits: "free",
    returns: "302 Location: <signed storage URL>; X-Content-Length, X-File-Content-Type",
    errors: ["404 unknown id or kind", "409 model not ready yet (Retry-After: 15)"],
    notes: "Follow the redirect without the Authorization header; the signed URL needs no key. files.<kind>.url on the model JSON is this endpoint.",
    sdk: "client.download3dModel(id, 'glb') // { bytes, contentType }",
    cli: "car-image 3d download <id> --format glb --out model.glb",
  },
  {
    method: "GET",
    path: "/api/v1/account",
    summary: "Plan and renewal (plan.meter: vehicle_images, or credits for accounts that paid before 2026-10-25), this month's vehicle images against the plan, credits (for 3D models, logos and upgrades), the next plan with its checkout link, payment method, 30-day usage, key scopes.",
    auth: "bearer",
    credits: "free",
    returns: "{data:{credits, auto_reload, has_payment_method, plan:{…, meter, limits:{images_per_month,…}}, default_market (the account's default market of sale, or null; set on the dashboard's organization page), terms:{version ('2026-10-12' for an account that paid before 2026-10-25, until its cutover; else '2026-10-25'), legacy, cutover_at (null = none scheduled), after_plan (the license rule when a paid plan ends, quoted from /terms), url}, pricing, usage_30d:{requests,images,cache_hit_rate}, limits_usage:{period, meter, vehicle_images_this_month:{used,limit,remaining}|null, distinct_vehicles_this_month:{used,limit,remaining}|null (credit meter), api_keys:{used,limit,remaining}, requests_per_minute_per_key, requests_per_minute_per_account}, renews_at, next_plan:{id,name,price,adds,checkout_url}, key:{prefix,scopes}}, links, request_id}",
    sdk: "client.account()",
    cli: "car-image whoami (alias: account)",
  },
  {
    method: "POST",
    path: "/api/v1/billing/checkout",
    summary: "Hosted Stripe Checkout URL for Pro or Business, or an in-place switch for an account already on a Stripe plan. Credits are not sold: {credits} answers 409 subscription_required_for_credits.",
    auth: "bearer",
    credits: "free (scope billing:write; CLI keys have it)",
    params: ["plan (pro|business)", "interval (month|year; default month)"],
    returns: "201 {data:{url,session_id,plan,interval,amount_cents}} | 200 {data:{url:null,changed:true,…}}",
    notes: "A human must complete the purchase in the browser. Agents must not initiate purchases without explicit approval.",
    sdk: "client.createPlanCheckout('pro', 'month')",
    cli: "car-image upgrade --plan pro",
  },
  {
    method: "POST",
    path: "/api/v1/billing/portal",
    summary: "Stripe Customer Portal URL (invoices, cards, plan).",
    auth: "bearer",
    credits: "free (scope billing:write)",
    returns: "201 {data:{url}}",
    sdk: "client.billingPortal()",
    cli: "car-image billing --portal",
  },
  {
    method: "POST",
    path: "/api/auth/device/code",
    summary: "Start browser-assisted CLI login (device flow).",
    auth: "public",
    credits: "free",
    params: ["client_name (optional)"],
    returns: "201 {device_code,user_code,verification_uri,verification_uri_complete,expires_in,interval}",
    cli: "car-image login",
  },
  {
    method: "POST",
    path: "/api/auth/device/token",
    summary: "Poll the device flow; returns a revocable API key once approved.",
    auth: "public",
    credits: "free",
    params: ["device_code"],
    returns: "200 {access_token,token_type:'Bearer',scope} | 400 {error:'authorization_pending'|'expired_token'}",
  },
  {
    method: "GET",
    path: "/api/health",
    summary: "Service health.",
    auth: "public",
    credits: "free",
    returns: "{status:'ok'|'degraded', checks, version}",
    cli: "car-image doctor",
  },
  {
    method: "GET",
    path: "/openapi.json",
    summary: "Full OpenAPI 3.1 contract (also /agents.md, /llms.txt, /errors.md).",
    auth: "public",
    credits: "free",
    cli: "car-image describe all",
  },
];

/** Human/agent-readable rendering of {@link API_REFERENCE}, optionally filtered. */
export function formatApiReference(filter?: string): string {
  const needle = filter?.trim().toLowerCase();
  const endpoints = needle
    ? API_REFERENCE.filter(
        (endpoint) =>
          endpoint.path.toLowerCase().includes(needle) ||
          endpoint.summary.toLowerCase().includes(needle) ||
          `${endpoint.method} ${endpoint.path}`.toLowerCase().includes(needle)
      )
    : API_REFERENCE;
  const header = [
    `Car Image API — base URL ${DEFAULT_BASE_URL}`,
    `Auth: Authorization: Bearer cimg_… (never in URLs). Errors: application/problem+json {type,title,status,detail,request_id}.`,
    `Pricing: plans meter vehicle images (one vehicle in one color from one angle, counted once a UTC month, delivered as often as needed at any size, stored or prepared first); images cost no credits. Free: ${PLAN_ALLOWANCES.free.vehicleImages} vehicle images per account, not per month (${PLAN_ALLOWANCES.free.courtesyImages} more once they run out), ${FREE_CREDITS} credits once, evaluation and personal projects. Pro $${PLAN_ALLOWANCES.pro.monthlyUsd}/month: ${PLAN_ALLOWANCES.pro.vehicleImages.toLocaleString("en-US")} images, ${PLAN_ALLOWANCES.pro.creditsPerMonth.toLocaleString("en-US")} credits a month, commercial license while subscribed. Business $${PLAN_ALLOWANCES.business.monthlyUsd}/month: ${PLAN_ALLOWANCES.business.vehicleImages.toLocaleString("en-US")} images, ${PLAN_ALLOWANCES.business.creditsPerMonth.toLocaleString("en-US")} credits. No overage: past an allowance new images answer 402 until the 1st (UTC); Free's do not renew. Credits are not sold and pay for 3D models (${MODEL_3D_PRICE}), make logos (1) and upgrades (20). Image Packs are one-time and self-hosted for good. GET /api/v1/pricing has live prices.`,
    `Vehicles: make + model + year, or vehicle=<stable id such as veh_395yw8tn73ff8> (from /api/v1/vehicles, /api/v1/vin or resolve), never both. Colors: ${COLORS.length} presets or any hex paint (URLs: color=1a2b3c bare; JSON: "#1a2b3c" or "1a2b3c"; responses echo #1a2b3c).`,
    "",
  ];
  if (endpoints.length === 0) {
    return `${header.join("\n")}No endpoint matches "${filter}". Known paths:\n${API_REFERENCE.map((e) => `  ${e.method} ${e.path}`).join("\n")}`;
  }
  const body = endpoints.map((endpoint) => {
    const lines = [`${endpoint.method} ${endpoint.path}`, `  ${endpoint.summary}`, `  auth: ${endpoint.auth}; credits: ${endpoint.credits}`];
    if (endpoint.params?.length) lines.push(`  params: ${endpoint.params.join("; ")}`);
    if (endpoint.returns) lines.push(`  returns: ${endpoint.returns}`);
    if (endpoint.errors?.length) lines.push(`  errors: ${endpoint.errors.join("; ")}`);
    if (endpoint.notes) lines.push(`  notes: ${endpoint.notes}`);
    if (endpoint.sdk) lines.push(`  sdk: ${endpoint.sdk}`);
    if (endpoint.cli) lines.push(`  cli: ${endpoint.cli}`);
    return lines.join("\n");
  });
  return `${header.join("\n")}${body.join("\n\n")}`;
}

/** Text content block as used in MCP tool results. */
export type McpTextContent = {
  type: "text";
  text: string;
}

/** Image content block as used in MCP tool results. */
export type McpImageContent = {
  type: "image";
  data: string;
  mimeType: string;
}

export type McpToolResult = {
  content: Array<McpTextContent | McpImageContent>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * A JSON payload as both readable text and structured content, with the
 * summary leading each. Some hosts hand a model only the structured content,
 * and a summary that lived only in the text block never reached it: the call
 * that renders a resolved vehicle, "ask the human first", a low balance, what
 * a model cost. A payload that has a `summary` of its own keeps it.
 */
export function jsonToolResult(value: Record<string, unknown>, summary?: string): McpToolResult {
  const text = summary ? `${summary}\n\n${JSON.stringify(value, null, 2)}` : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], structuredContent: summary ? { summary, ...value } : value };
}

/** An `isError` result whose text tells the agent what to do next. */
export function errorToolResult(message: string, extra: Record<string, unknown> = {}): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...extra },
  };
}

/** Standard guidance appended to error results, keyed by HTTP-ish status. */
export function nextStepFor(status: number | null | undefined): string {
  switch (status) {
    case 401:
      return "The API key is missing or invalid. Set CAR_IMAGE_API_KEY (or run `car-image login`); never paste keys into prompts.";
    case 402:
      return `Payment required; nothing was charged. Stop. With code plan_image_limit the allowance is used (images already received keep serving; it resets at resets_at, or never on Free when resets_at is null): give the human checkout_url (a higher plan) with its price, or pack_url (Image Packs). With code subscription_required_for_credits the account lacks credits for a 3D model, logo or upgrade; credits are not sold, so give checkout_url (a plan, which includes credits every month). Buy only when the human asks or a spending mandate they set covers it.`;
    case 403:
      return "This key lacks the required scope. Ask the human to create a key with the right scopes in the dashboard.";
    case 404:
      return "The vehicle is not in the catalog under that name (or the id is unknown). When suggestions are listed, retry with the id of the one that is plainly the vehicle (vehicle: <id>) or show them to the human; otherwise use resolve_vehicle, search_vehicles or decode_vin to find its vehicle id. Do not send the same name again, and never substitute another car without saying so.";
    case 409:
      return "Not ready or still in progress (a 3D model still being made, or an Idempotency-Key request still running). Wait the retry_after seconds, then poll again; do not create a second one.";
    case 429:
      return "Rate limited. Wait the retry_after seconds before retrying; do not hammer the API.";
    case 503:
      return "Temporarily unavailable (a feature is switched off or at its daily capacity); nothing was charged. Wait the retry_after seconds before trying again, and tell the human if it persists.";
    default:
      return "Retry once if this looks transient; otherwise report the detail and request_id to the human.";
  }
}

/**
 * {@link nextStepFor} for a decode_vin error. A refused (400) or unknown (404)
 * VIN needs the human to re-check it; the generic 404 step would send the agent
 * to the catalog or back to decode_vin. NHTSA's data covers vehicles made for
 * the US market, so a correctly typed VIN from another market is a 404 too.
 */
export function vinNextStepFor(status: number | null | undefined): string {
  switch (status) {
    case 400:
      return "Ask the human to re-check the VIN rather than guessing (what reads as an I, O or Q is a 1 or a 0), and do not send it again unchanged.";
    case 404:
      return "Do not decode the same VIN again. Ask the human to re-check it, above all the first three characters (the maker code): look-alikes such as 8/B, 5/S and 2/Z are the usual slip. Send what they are sure of as a partial VIN with * for each unknown position and a year hint. NHTSA's data covers vehicles made for the US market; for any other car, or when the human knows the make and model, resolve_vehicle or search_vehicles finds it without a VIN.";
    default:
      return nextStepFor(status);
  }
}

export { checkoutLinkSchema, helpQuerySchema } from "./support.js";
