import type { AgentLimitResponse, AgentPurchaseResponse, CheckoutLinkInput, BillingLinkResponse, CheckoutStatusResponse, HelpResponse, PricingResponse, PurchasePlanInput } from "./support.js";
import { CarImageError } from "./errors.js";
import type {
  CreatedPackBatchResponse, PackBatchInput, PackBatchItemInput, PackBatchResponse, PackExportInput, PackExportResponse, PackImageOptions,
  PackImageResult, PackListResponse, PackManifestResponse, PackQuality, PackQuoteResponse, PackResponse, PackUnit,
} from "./packs.js";
import { IMAGE_REPORT_CATEGORIES, IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH, IMAGE_REPORT_REASON_MAX_LENGTH, IMAGE_REPORT_TYPES } from "./types.js";
import { campaignTags, imageRequestBody, imageSearchParams, makeLogoSearchParams, isColor, normalizeMarket, normalizeYear, vehicleRequestBody } from "./params.js";
import { RETRYABLE_STATUSES, backoffDelayMs, retryDelayMs } from "./retry.js";
import {
  COLORS,
  DEFAULT_BASE_URL,
  MAX_CHECK_VEHICLES,
  MAX_CHECK_VIEWS_VEHICLES,
  MODEL_3D_FILE_KINDS,
  REFERRAL_SOURCES,
  VEHICLE_ID_PATTERN,
  type AccountResponse,
  type CampaignTags,
  type CampaignUsageParams,
  type CampaignUsageResponse,
  type MembersResponse,
  type BuildingResponse,
  type PlanCheckoutResponse,
  type PlanInterval,
  type CreateImageUrlsOptions,
  type CreateImageUrlsResponse,
  type AvailabilityCheckResponse,
  type ImageAvailabilityParams,
  type ImageAvailabilityResponse,
  type ImageUsage,
  type CreateModel3dOptions,
  type CreateModel3dResponse,
  type CreateRequestInput,
  type FiledFeedbackResponse,
  type IssueContext,
  type ListReviewsParams,
  type ReportIssueInput,
  type RequestFeatureInput,
  type ReviewInput,
  type ReviewListResponse,
  type ReviewResponse,
  type CreateRequestResponse,
  type DecodeVinOptions,
  type DeviceCodeResponse,
  type DeviceTokenResult,
  type ImageReportInput,
  type ImageReportResponse,
  type FetchLike,
  type HealthResponse,
  type ImageParams,
  type TaggedImageParams,
  type MakeLogoParams,
  type ImageResult,
  type ImageSource,
  type ImageUrlResponse,
  type ListRequestsParams,
  type Model3d,
  type Model3dFileKind,
  type Model3dFileResult,
  type Model3dListResponse,
  type Model3dResponse,
  type OpenApiDocument,
  type OptionsResponse,
  type PortalResponse,
  type ReferralResponse,
  type ReferralSource,
  type RequestCommentResponse,
  type RequestCommentsResponse,
  type RequestDetailResponse,
  type RequestListResponse,
  type RequestResponse,
  type ResolveResponse,
  type TelemetryEvent,
  type VehicleCheckEntry,
  type VehicleCheckResponse,
  type VehicleCheckResult,
  type VehicleCheckSummary,
  type VehicleMakeModelsResponse,
  type VehicleMakesResponse,
  type VehicleModelLookupResponse,
  type VehicleModelsResponse,
  type VehicleResponse,
  type VehicleSearchResponse,
  type VehicleSelector,
  type VehicleYearsResponse,
  type VehicleId,
  type VinResponse,
  type WaitModel3dOptions,
  type Appearance,
  type Market,
  type MarketOption,
} from "./types.js";
import type {
  CreatedWebhookResponse,
  CreateWebhookInput,
  DeletedWebhookResponse,
  EventListResponse,
  ListEventsParams,
  UpdateWebhookInput,
  WebhookDeliveriesResponse,
  WebhookListResponse,
  WebhookResponse,
  WebhookTestResponse,
} from "./webhooks.js";
import { SDK_VERSION } from "./version.js";

export interface CarImageClientOptions {
  /** `cimg_…` key. Falls back to `process.env.CAR_IMAGE_API_KEY` when running on a server. */
  apiKey?: string;
  /** API origin; defaults to `process.env.CAR_IMAGE_API_URL` or https://carimage.dev. */
  baseUrl?: string;
  /** Custom fetch (tests, polyfills, instrumentation). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Sent as `User-Agent` (ignored by browsers). Defaults to `car-image-sdk/<version>`. */
  userAgent?: string;
  /** Retries on 429/503 (and network failures for GET). Default 2; 0 disables. */
  maxRetries?: number;
  /** Base for exponential backoff with full jitter. Default 500 ms. */
  retryBaseDelayMs?: number;
  /**
   * Upper bound for any single wait. A 429/503 whose `Retry-After` is longer is
   * not retried: it throws, with `retryAfterSeconds` set. Default 30 000 ms.
   */
  maxRetryDelayMs?: number;
  /** Per-attempt timeout. Unset by default. */
  timeoutMs?: number;
  /** Sleep implementation; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Overrides the client-wide `maxRetries` for this call. */
  retries?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface SendOptions extends RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "HEAD" | "DELETE";
  body?: string;
  accept?: string;
  auth?: "required" | "optional" | "none";
  /** `manual` returns a 3xx as-is instead of following it (see `download3dModel`). */
  redirect?: RequestRedirect;
  /** A POST that changes nothing (a vehicle check) is as safe to repeat after a dropped connection as a GET. */
  readOnly?: boolean;
  /** Send no `User-Agent`, so a browser on another origin makes a simple request with no preflight. */
  simple?: boolean;
}

/** Options for `checkVehicles`. */
export interface CheckVehiclesOptions extends RequestOptions {
  /** The market of sale the list is for; an entry may name its own (`market`). Omit for the account default, or none. */
  market?: Market;
  /**
   * Also say which of each matched vehicle's nine views are prepared
   * and which of those are verified (`views` on each match, `views_complete`
   * and `views_verified` in the summary). Still free;
   * 100 entries a request instead of 2,000.
   */
  views?: boolean;
  /** Entries per request, 1 to 2,000 (the default and the most one check reads), or to 100 with `views`. */
  batchSize?: number;
  /** Called after each request with how many entries have been checked so far and how many there are. */
  onProgress?: (checked: number, total: number) => void;
}

type EnvLike = { env?: Record<string, string | undefined> } | undefined;

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: EnvLike }).process;
  const value = proc?.env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A usage header's count: a number, or null for `unlimited`. */
function allowanceHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  return raw === null || raw.trim() === "unlimited" ? null : intHeader(headers, name);
}

/** The vehicle-image meter's headers (`X-Vehicle-Images-*`); null on the credit meter or older servers. */
export function usageFromHeaders(headers: Headers): ImageUsage | null {
  const used = intHeader(headers, "x-vehicle-images-used");
  if (used === null) return null;
  return {
    vehicleImages: { used, included: allowanceHeader(headers, "x-vehicle-images-included") },
  };
}

function sourceHeader(headers: Headers): ImageSource | null {
  const raw = headers.get("x-image-source");
  return raw === "cache" || raw === "generated" ? raw : null;
}

/** `X-Vehicle-Appearance`: `default`, or `default; market=AU`. */
function appearanceHeader(headers: Headers): Appearance | null {
  const raw = headers.get("x-vehicle-appearance");
  if (raw === null) return null;
  const [scope, ...members] = raw.split(";").map((part) => part.trim());
  if (scope !== "default" && scope !== "market") return null;
  const market = members.map((member) => /^market=([A-Za-z]{2})$/.exec(member)?.[1]).find((value) => value !== undefined);
  return { market: market ? market.toUpperCase() : null, scope };
}

/** `X-Image-Verified`, a UTC day, or null. */
function verifiedHeader(headers: Headers): string | null {
  const raw = headers.get("x-image-verified");
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** `X-Campaign`, percent-encoded UTF-8; null when absent or undecodable. */
function campaignHeader(headers: Headers): string | null {
  const raw = headers.get("x-campaign");
  if (raw === null || raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Query string for GET /api/v1/images/car: the image's parameters, then its campaign tracking labels. */
function taggedImageSearch(params: TaggedImageParams): URLSearchParams {
  const search = imageSearchParams(params);
  const tags = campaignTags(params);
  if (tags.campaign !== undefined) search.set("campaign", tags.campaign);
  if (tags.pieces !== undefined) search.set("pieces", String(tags.pieces));
  return search;
}

/** A `getCampaignUsage` bound: a Date as an ISO timestamp, a string as given. */
function usageBound(value: string | Date | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError(`${name} is an invalid Date`);
    return value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a date such as 2026-11-01, an ISO 8601 timestamp or a Date`);
  return value.trim();
}

function vehicleIdHeader(headers: Headers): VehicleId | null {
  const raw = headers.get("x-vehicle-id");
  return raw !== null && VEHICLE_ID_PATTERN.test(raw) ? raw : null;
}

/** The last call this client made that failed: what `reportIssue` attaches. */
export interface LastFailure {
  request_id: string | null;
  endpoint: string;
  method: string;
  status: number;
  error_code: string | null;
  at: string;
}

/** Validates and URL-encodes a request id for use in a path. */
/** The JSON body of POST /api/v1/images/reports, checked the way the server reads it so a mistake fails before the call. */
function imageReportBody(input: ImageReportInput): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new TypeError("reportImage requires an input object");
  const body: Record<string, unknown> = {};
  if (input.type !== undefined) {
    if (!(IMAGE_REPORT_TYPES as readonly string[]).includes(input.type)) throw new TypeError(`type must be one of ${IMAGE_REPORT_TYPES.join(", ")}`);
    body.type = input.type;
  }
  const reason = input.reason?.trim();
  if (reason) {
    if (reason.length > IMAGE_REPORT_REASON_MAX_LENGTH) throw new TypeError(`reason must be at most ${IMAGE_REPORT_REASON_MAX_LENGTH} characters`);
    body.reason = reason;
  }
  const externalRef = input.externalRef?.trim();
  if (externalRef) {
    if (externalRef.length > IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH) throw new TypeError(`externalRef must be at most ${IMAGE_REPORT_EXTERNAL_REF_MAX_LENGTH} characters`);
    body.external_ref = externalRef;
  }
  if (input.type === "missing_vehicle") {
    const make = input.make?.trim();
    const model = input.model?.trim();
    if (!make || !model) throw new TypeError("a missing_vehicle report needs make and model");
    body.make = make;
    body.model = model;
    body.year = normalizeYear(input.year);
    return body;
  }
  if (input.category !== undefined) {
    if (!(IMAGE_REPORT_CATEGORIES as readonly string[]).includes(input.category)) throw new TypeError(`category must be one of ${IMAGE_REPORT_CATEGORIES.join(", ")}`);
    body.category = input.category;
  }
  if (input.assetId !== undefined) {
    if (!input.assetId.trim()) throw new TypeError("assetId must not be empty");
    body.asset_id = input.assetId.trim();
  } else if (input.requestId !== undefined) {
    if (!input.requestId.trim()) throw new TypeError("requestId must not be empty");
    body.request_id = input.requestId.trim();
  } else if ("vehicle" in input || "make" in input) {
    Object.assign(body, vehicleRequestBody(input));
    if (input.view) body.view = input.view;
    if (input.color) body.color = String(input.color).trim();
  } else {
    throw new TypeError("reportImage requires assetId, requestId, a vehicle id, or make/model/year (or type missing_vehicle)");
  }
  return body;
}

function requestPath(id: string): string {
  if (typeof id !== "string" || !id.trim()) throw new TypeError("request id is required");
  return encodeURIComponent(id.trim());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A fresh Idempotency-Key from Web Crypto; null where no secure randomness exists. */
function generateIdempotencyKey(): string | null {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof webCrypto?.randomUUID === "function" ? `sdk_${webCrypto.randomUUID()}` : null;
}

/**
 * Client for the Car Image API. Safe for Node 20+, edge runtimes and browsers
 * (in browsers, prefer signed delivery URLs created server-side so the API key
 * never ships to the client).
 */
export class CarImageClient {
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly timeoutMs: number | undefined;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private failure: LastFailure | null = null;

  constructor(options: CarImageClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? readEnv("CAR_IMAGE_API_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey?.trim() || readEnv("CAR_IMAGE_API_KEY");
    const fetchImpl = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new Error("No fetch implementation available. Pass { fetch } to CarImageClient.");
    }
    this.fetchImpl = fetchImpl;
    this.userAgent = options.userAgent ?? `car-image-sdk/${SDK_VERSION}`;
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
    this.timeoutMs = options.timeoutMs;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * The last call that failed (its request id, endpoint and error code), or
   * null. `reportIssue` attaches it when no request id is given.
   */
  get lastFailure(): LastFailure | null {
    return this.failure;
  }

  /** Whether a key is configured; the key itself is never exposed. */
  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  /** Display form such as `cimg_A1b2…9zY`; never logs the full key. */
  maskedApiKey(): string | null {
    if (!this.apiKey) return null;
    if (this.apiKey.length <= 12) return `${this.apiKey.slice(0, 4)}…`;
    return `${this.apiKey.slice(0, 9)}…${this.apiKey.slice(-3)}`;
  }

  /** Keeps the key out of `JSON.stringify(client)`, logs and error reports. */
  toJSON(): Record<string, unknown> {
    return {
      baseUrl: this.baseUrl,
      userAgent: this.userAgent,
      maxRetries: this.maxRetries,
      apiKey: this.maskedApiKey(),
    };
  }

  // ---------------------------------------------------------------- images

  /**
   * GET /api/v1/images/car — the bytes plus usage headers. On a plan this
   * counts one vehicle image for the month (vehicle, color and angle; every
   * further delivery of it, at any size or format, is included) and costs no
   * credits (`usage`); legacy credit-meter accounts pay 1 credit
   * (`creditsRemaining`). `campaign` and `pieces` tag the request for
   * campaign tracking ({@link CampaignTags}) and never change the image.
   */
  async getImage(params: TaggedImageParams, options: RequestOptions = {}): Promise<ImageResult> {
    const response = await this.send(`/api/v1/images/car?${taggedImageSearch(params)}`, {
      ...options,
      accept: "image/png, image/webp, image/jpeg, image/*;q=0.9, application/problem+json;q=0.8",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      width: intHeader(response.headers, "x-image-width"),
      height: intHeader(response.headers, "x-image-height"),
      creditsCharged: intHeader(response.headers, "x-credits-charged"),
      creditsRemaining: intHeader(response.headers, "x-credits-remaining"),
      usage: usageFromHeaders(response.headers),
      source: sourceHeader(response.headers),
      etag: response.headers.get("etag"),
      requestId: response.headers.get("x-request-id"),
      vehicleId: vehicleIdHeader(response.headers),
      appearance: appearanceHeader(response.headers),
      verifiedOn: verifiedHeader(response.headers),
      campaign: campaignHeader(response.headers),
      pieces: intHeader(response.headers, "x-pieces"),
    };
  }

  /** GET /api/v1/images/logo — 1 credit. Third-party trademarks; no license granted. */
  async getMakeLogo(params: MakeLogoParams, options: RequestOptions = {}): Promise<ImageResult> {
    const response = await this.send(`/api/v1/images/logo?${makeLogoSearchParams(params)}`, {
      ...options,
      accept: "image/png, image/webp, image/jpeg, image/*;q=0.9, application/problem+json;q=0.8",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      width: intHeader(response.headers, "x-image-width"),
      height: intHeader(response.headers, "x-image-height"),
      creditsCharged: intHeader(response.headers, "x-credits-charged"),
      creditsRemaining: intHeader(response.headers, "x-credits-remaining"),
      usage: usageFromHeaders(response.headers),
      source: sourceHeader(response.headers),
      etag: response.headers.get("etag"),
      requestId: response.headers.get("x-request-id"),
      vehicleId: vehicleIdHeader(response.headers),
      appearance: null,
    };
  }

  /** GET /api/v1/images/car with `Accept: application/json` — a signed URL; counts the vehicle image like `getImage` (1 credit on the legacy credit meter). */
  async getImageUrl(params: TaggedImageParams, options: RequestOptions = {}): Promise<ImageUrlResponse> {
    const response = await this.send(`/api/v1/images/car?${taggedImageSearch(params)}`, {
      ...options,
      accept: "application/json",
    });
    return this.json<ImageUrlResponse>(response);
  }

  /**
   * The keyless `mode=cached` URL of an image: free, and it never renders.
   * Without credentials it loads only a public preview, a render the /cars
   * pages show (a 308 to its `/images/previews/…` URL); any other rendered
   * image answers 401 `signed_url_required` with `cached: true`, and one not
   * rendered yet 404 `not_cached`. To embed any other image in a page, mint a
   * signed URL with {@link createImageUrls}.
   */
  cachedImageUrl(params: ImageParams): string {
    const search = imageSearchParams(params);
    // One URL per image: a market is not part of what a cached image is.
    search.delete("market");
    search.set("mode", "cached");
    return `${this.baseUrl}/images/car.png?${search}`;
  }

  /**
   * Whether an image is already rendered, free and without a key: asks
   * {@link cachedImageUrl}, which never renders or bills. True on 200 (a
   * public preview) and on 401 `signed_url_required` (rendered, but delivered
   * through a signed URL or a key), false on 404 `not_cached`; any other
   * answer (an unknown vehicle id, an invalid parameter) throws a
   * CarImageError. A ready image then loads at once through `createImageUrls`
   * or `getImage`; a missing one is prepared by them. To check many images,
   * and what they would count against the month, use {@link checkAvailability}.
   */
  async isImageReady(params: ImageParams, options: RequestOptions = {}): Promise<boolean> {
    const response = await this.rawSend(this.cachedImageUrl(params), {
      ...options,
      auth: "none",
      simple: true,
      accept: "image/png, image/webp, image/jpeg, image/*;q=0.9, application/problem+json;q=0.8",
    });
    if (response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Body already consumed or not cancellable; nothing to release.
      }
      return true;
    }
    const error = await CarImageError.fromResponse(response);
    // Rendered, but not one of the public previews served without credentials.
    if (error.status === 401 && error.problem?.code === "signed_url_required") return true;
    // Servers before `code: "not_cached"` answered the same 404 under this title.
    if (error.status === 404 && (error.problem?.code === "not_cached" || error.title === "Image not cached")) return false;
    throw error;
  }

  /**
   * POST /api/v1/image-urls — up to 50 images per call. On a plan each URL's
   * image counts once for the month when the URL is made (`billing.vehicle_images`),
   * and loads and renewals add nothing; legacy credit-meter accounts pay 1
   * credit per URL at creation and one per renewed window.
   *
   * Campaign tracking: `campaign` and `pieces` on an image are that URL's
   * own; in `options` they are the default for every image that names none.
   * Each `data[]` item echoes its labels, and the top-level `pieces` is the
   * sum over the URLs. They never change an image or the charge.
   */
  async createImageUrls(
    images: TaggedImageParams | TaggedImageParams[],
    options: CreateImageUrlsOptions & RequestOptions = {}
  ): Promise<CreateImageUrlsResponse> {
    const list = Array.isArray(images) ? images : [images];
    if (list.length < 1 || list.length > 50) {
      throw new RangeError(`createImageUrls accepts 1 to 50 images (received ${list.length})`);
    }
    const { ttlSeconds, maxUses, renew, renewDays, idempotencyKey, market, campaign, pieces, ...request } = options;
    const body: Record<string, unknown> = {
      images: list.map((image) => ({ ...imageRequestBody(image), ...campaignTags(image) })),
      ...campaignTags({ campaign, pieces } satisfies CampaignTags),
    };
    if (market !== undefined) body.market = normalizeMarket(market);
    if (ttlSeconds !== undefined) body.ttl_seconds = ttlSeconds;
    if (maxUses !== undefined) body.max_uses = maxUses;
    if (renew !== undefined) body.renew = renew;
    if (renewDays !== undefined) body.renew_days = renewDays;
    // Every call carries an Idempotency-Key, so a retry after a dropped
    // connection replays the answer instead of buying a second batch.
    const key = idempotencyKey ?? generateIdempotencyKey();
    const headers: Record<string, string> = { ...request.headers };
    if (key) headers["Idempotency-Key"] = key;
    const response = await this.send("/api/v1/image-urls", {
      ...request,
      headers,
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = await this.json<CreateImageUrlsResponse>(response);
    // A replay carries `Idempotent-Replayed: true`; surface it so a caller
    // (a batch script, the stdio MCP server) can tell a retry from a mint.
    if (response.headers.get("idempotent-replayed") === "true") result.idempotent_replayed = true;
    return result;
  }

  /** GET /api/v1/images/availability — cached/prepared views, which of them are verified, quality and wait estimates; never renders or bills. */
  async getImageAvailability(params: ImageAvailabilityParams, options: RequestOptions = {}): Promise<ImageAvailabilityResponse> {
    const query = imageSearchParams(params);
    const response = await this.send(`/api/v1/images/availability?${query}`, options);
    return this.json<ImageAvailabilityResponse>(response);
  }

  /**
   * POST /api/v1/images/availability — free and read-only (renders, queues and
   * counts nothing). For up to 200 images (the image objects
   * `createImageUrls` takes), whether each vehicle view is prepared (so every
   * color of it serves now), whether the prepared image is verified (`false`
   * says only that it has not been verified yet), whether asking for it would count a vehicle
   * image this month (a view not prepared yet counts as one like any other),
   * and whether the whole list fits the plan's allowance. Check a catalog here before importing it.
   */
  async checkAvailability(images: ImageParams | ImageParams[], options: MarketOption & RequestOptions = {}): Promise<AvailabilityCheckResponse> {
    const list = Array.isArray(images) ? images : [images];
    if (list.length < 1 || list.length > 200) {
      throw new RangeError(`checkAvailability accepts 1 to 200 images (received ${list.length})`);
    }
    const { market, ...request } = options;
    const response = await this.send("/api/v1/images/availability", {
      ...request,
      method: "POST",
      body: JSON.stringify({ images: list.map(imageRequestBody), ...(market === undefined ? {} : { market: normalizeMarket(market) }) }),
    });
    return this.json<AvailabilityCheckResponse>(response);
  }

  /** GET /api/v1/images/options — public; views, colors, sizes, formats, pricing, catalog. */
  async options(options: RequestOptions = {}): Promise<OptionsResponse> {
    const response = await this.send("/api/v1/images/options", { ...options, auth: "optional" });
    return this.json<OptionsResponse>(response);
  }

  /** POST /api/v1/images/resolve — free; turns "red 2024 porsche 911 side view" into parameters. */
  async resolve(query: string, options: MarketOption & RequestOptions = {}): Promise<ResolveResponse> {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("query is required");
    const { market, ...request } = options;
    const response = await this.send("/api/v1/images/resolve", {
      ...request,
      method: "POST",
      body: JSON.stringify({ query: query.trim(), ...(market === undefined ? {} : { market: normalizeMarket(market) }) }),
    });
    return this.json<ResolveResponse>(response);
  }

  // -------------------------------------------------------------- catalog

  /**
   * GET /api/v1/vehicles — public. No filter: years; `year`: makes; `year`+`makeId`:
   * models (each with its vehicle id); `make` slug: that make's models; `make`+`model`
   * slugs: the model's years, each with its vehicle id.
   */
  async vehicles(filter?: Record<string, never>, options?: RequestOptions): Promise<VehicleYearsResponse>;
  async vehicles(filter: { year: number }, options?: RequestOptions): Promise<VehicleMakesResponse>;
  async vehicles(filter: { year: number; makeId: number }, options?: RequestOptions): Promise<VehicleModelsResponse>;
  async vehicles(filter: { make: string; year?: number }, options?: RequestOptions): Promise<VehicleMakeModelsResponse>;
  async vehicles(filter: { make: string; model: string; year?: number }, options?: RequestOptions): Promise<VehicleModelLookupResponse>;
  async vehicles(
    filter: { year?: number; makeId?: number; make?: string; model?: string } = {},
    options: RequestOptions = {}
  ): Promise<VehicleYearsResponse | VehicleMakesResponse | VehicleModelsResponse | VehicleMakeModelsResponse | VehicleModelLookupResponse> {
    const search = new URLSearchParams();
    if (filter.year !== undefined) search.set("year", String(normalizeYear(filter.year)));
    if (filter.makeId !== undefined) search.set("makeId", String(filter.makeId));
    if (filter.make !== undefined) search.set("make", filter.make.trim());
    if (filter.model !== undefined) search.set("model", filter.model.trim());
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/vehicles${query}`, { ...options, auth: "optional" });
    return this.json(response);
  }

  /** GET /api/v1/vehicles/{id} — public; the vehicle a stable id names, its years and the image URLs that render it. */
  async vehicle(id: string, options: RequestOptions = {}): Promise<VehicleResponse> {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("vehicle id is required");
    const response = await this.send(`/api/v1/vehicles/${encodeURIComponent(id.trim())}`, { ...options, auth: "optional" });
    return this.json<VehicleResponse>(response);
  }

  /**
   * POST /api/v1/vehicles/check — free; which of a list of vehicles the catalog
   * carries. Each entry (make, model and year as your data spells them, or a
   * stored vehicle id, plus an optional `ref`) is read the way an image request
   * reads it and answered as a `match` with the id to store and render by, a
   * `suggestion`, a `miss` or an `invalid` entry. Any length: a list longer
   * than `batchSize` (at most 2,000, or 100 with `views`) goes in consecutive
   * requests and the answers are merged, with `index` counting across the
   * whole list. Once a long list has sent its first request, a later one
   * refused by the account's checks a minute waits for the minute to pass (at
   * most three times, never with retries off), so the list finishes; a single
   * request answers the 429 at once.
   * With `views`, each match also says how many of its nine views are
   * prepared, which are missing and which of the prepared ones are verified.
   */
  async checkVehicles(vehicles: readonly VehicleCheckEntry[], options: CheckVehiclesOptions = {}): Promise<VehicleCheckResponse> {
    if (!Array.isArray(vehicles) || vehicles.length === 0) throw new TypeError("vehicles must be a non-empty array");
    const { views = false, onProgress, market: listMarket, ...rest } = options;
    const market = listMarket === undefined ? undefined : normalizeMarket(listMarket);
    const most = views ? MAX_CHECK_VIEWS_VEHICLES : MAX_CHECK_VEHICLES;
    const { batchSize = most, ...request } = rest;
    const retries = request.retries ?? this.maxRetries;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > most) {
      throw new RangeError(`batchSize must be an integer from 1 to ${most}${views ? " with views" : ""}`);
    }
    const summary: VehicleCheckSummary = { total: 0, match: 0, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 0 };
    const results: VehicleCheckResult[] = [];
    const matched = new Set<string>();
    const complete = new Set<string>();
    const verified = new Set<string>();
    let requestId = "";
    let appearance: Appearance | undefined;
    for (let start = 0; start < vehicles.length; start += batchSize) {
      const body = JSON.stringify({ vehicles: vehicles.slice(start, start + batchSize), ...(views ? { views: true } : {}), ...(market ? { market } : {}) });
      let page: VehicleCheckResponse;
      for (let waits = 0; ; waits += 1) {
        try {
          page = await this.json<VehicleCheckResponse>(await this.send("/api/v1/vehicles/check", { ...request, method: "POST", body, readOnly: true }));
          break;
        } catch (error) {
          // Ten checks a minute per account: a long list waits for the next minute rather than failing halfway.
          const wait = error instanceof CarImageError && error.status === 429 ? error.retryAfterSeconds : null;
          if (wait === null || wait > 60 || start === 0 || retries === 0 || waits >= 3 || request.signal?.aborted) throw error;
          await this.sleepUnlessAborted(wait * 1_000, request.signal);
        }
      }
      for (const key of ["total", "match", "suggestion", "miss", "invalid"] as const) summary[key] += page.data.summary[key];
      for (const result of page.data.results) {
        results.push({ ...result, index: result.index + start });
        if (result.vehicle) matched.add(result.vehicle.id);
        if (result.vehicle && result.views?.missing.length === 0) complete.add(result.vehicle.id);
        // Every prepared view verified; a server that predates the field says nothing, so nothing counts.
        if (result.vehicle && result.views && result.views.prepared > 0 && result.views.verified?.length === result.views.prepared) verified.add(result.vehicle.id);
      }
      requestId = page.request_id;
      appearance = page.data.appearance ?? appearance;
      onProgress?.(Math.min(start + batchSize, vehicles.length), vehicles.length);
    }
    summary.distinct_vehicles = matched.size;
    if (views) {
      summary.views_complete = complete.size;
      summary.views_verified = verified.size;
    }
    return { data: { ...(appearance ? { appearance } : {}), summary, results }, request_id: requestId };
  }

  // ------------------------------------------------------------------ VIN

  /**
   * GET /api/v1/vin/{vin} — free; decodes a full 17-character VIN, or a partial
   * one of at least 5 characters with `*` for unknown positions, and names the
   * catalog vehicle it maps to (`data.vehicle`, with the id that renders it).
   */
  async decodeVin(vin: string, options: DecodeVinOptions & RequestOptions = {}): Promise<VinResponse> {
    if (typeof vin !== "string" || !vin.trim()) throw new TypeError("vin is required");
    const { year, ...request } = options;
    const search = new URLSearchParams();
    if (year !== undefined) search.set("year", String(normalizeYear(year)));
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/vin/${encodeURIComponent(vin.trim())}${query}`, request);
    return this.json<VinResponse>(response);
  }

  // ------------------------------------------------------------ 3D models

  /**
   * POST /api/v1/3d — a textured 3D model (GLB, USDZ, FBX and a thumbnail) of one
   * vehicle in one paint color. Costs `credits_per_model` credits (100 since
   * 2026-09-19) at creation, whether the model is cached, in progress or new; a
   * failed model is refunded, and polling and downloads are free. Resolves at
   * once with `status` queued or processing (202), or ready when it was cached
   * (200); `wait3dModel` polls until it settles. Every call carries an
   * `Idempotency-Key`, like `createImageUrls`.
   */
  async create3dModel(vehicle: VehicleSelector, options: CreateModel3dOptions & RequestOptions = {}): Promise<CreateModel3dResponse> {
    const { color, webhookUrl, webhookSecret, publish, idempotencyKey, ...request } = options;
    const body: Record<string, unknown> = vehicleRequestBody(vehicle);
    if (color !== undefined) {
      if (!isColor(color)) throw new TypeError(`Invalid color "${String(color)}": expected one of ${COLORS.join(", ")}, or a hex paint such as #1a2b3c`);
      body.color = String(color).trim();
    }
    if (webhookUrl !== undefined) body.webhook_url = webhookUrl;
    if (webhookSecret !== undefined) body.webhook_secret = webhookSecret;
    if (publish !== undefined) body.publish = publish;
    const key = idempotencyKey ?? generateIdempotencyKey();
    const headers: Record<string, string> = { ...request.headers };
    if (key) headers["Idempotency-Key"] = key;
    const response = await this.send("/api/v1/3d", {
      ...request,
      headers,
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.json<CreateModel3dResponse>(response);
  }

  /** GET /api/v1/3d/{id} — free; status, progress and, once ready, the files of one 3D request. */
  async get3dModel(id: string, options: RequestOptions = {}): Promise<Model3dResponse> {
    const response = await this.send(`/api/v1/3d/${requestPath(id)}`, options);
    return this.json<Model3dResponse>(response);
  }

  /**
   * POST /api/v1/3d/{id}/publish — free; gives one of your 3D requests
   * key-free URLs and a two-line embed (`data.public`). The URLs are stable
   * from this moment; the files follow when the model is ready. Idempotent.
   */
  async publish3dModel(id: string, options: RequestOptions = {}): Promise<Model3dResponse> {
    const response = await this.send(`/api/v1/3d/${requestPath(id)}/publish`, { ...options, method: "POST" });
    return this.json<Model3dResponse>(response);
  }

  /** DELETE /api/v1/3d/{id}/publish — free; the public URLs stop working within the hour and `data.public` is null again. Idempotent. */
  async unpublish3dModel(id: string, options: RequestOptions = {}): Promise<Model3dResponse> {
    const response = await this.send(`/api/v1/3d/${requestPath(id)}/publish`, { ...options, method: "DELETE" });
    return this.json<Model3dResponse>(response);
  }

  /** GET /api/v1/3d — free; the caller's recent 3D requests, newest first (`limit` 1–50, default 20). */
  async list3dModels(options: { limit?: number } & RequestOptions = {}): Promise<Model3dListResponse> {
    const { limit, ...request } = options;
    const search = new URLSearchParams();
    if (limit !== undefined) search.set("limit", String(limit));
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/3d${query}`, request);
    return this.json<Model3dListResponse>(response);
  }

  /**
   * GET /api/v1/3d/{id}/files/{kind} — free; the bytes of one file of a ready
   * model. The route answers 302 to a short-lived signed URL on the storage
   * host, which is followed here by hand so the API key never travels there:
   * `fetch` attaches the key only to the client's own origin.
   */
  async download3dModel(id: string, kind: Model3dFileKind, options: RequestOptions = {}): Promise<Model3dFileResult> {
    if (!(MODEL_3D_FILE_KINDS as readonly string[]).includes(kind)) {
      throw new RangeError(`kind must be one of: ${MODEL_3D_FILE_KINDS.join(", ")}`);
    }
    const redirect = await this.rawSend(`/api/v1/3d/${requestPath(id)}/files/${kind}`, { ...options, accept: "*/*", redirect: "manual" });
    const requestId = redirect.headers.get("x-request-id");
    const location = redirect.headers.get("location");
    if (redirect.status >= 300 && redirect.status < 400 && location) {
      try {
        await redirect.body?.cancel();
      } catch {
        // Nothing to release.
      }
      const target = new URL(location, this.baseUrl).toString();
      const file = await this.fetch(target, { headers: { Accept: "*/*" }, signal: this.signalFor(options) });
      if (!file.ok) {
        throw new CarImageError({
          status: file.status,
          title: "3D file download failed",
          detail: `The storage host answered HTTP ${file.status} for the ${kind} file. Ask for the model again to get a fresh link.`,
          requestId,
        });
      }
      return {
        kind,
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.headers.get("content-type") ?? redirect.headers.get("x-file-content-type") ?? "application/octet-stream",
        requestId,
      };
    }
    if (redirect.ok) {
      return {
        kind,
        bytes: new Uint8Array(await redirect.arrayBuffer()),
        contentType: redirect.headers.get("content-type") ?? "application/octet-stream",
        requestId,
      };
    }
    if (redirect.status === 0 || redirect.type === "opaqueredirect") {
      throw new CarImageError({
        status: 0,
        title: "Redirect hidden by the runtime",
        detail: `This runtime does not expose redirects; fetch model.files.${kind}.url yourself and follow it without the API key.`,
        requestId,
      });
    }
    throw await CarImageError.fromResponse(redirect);
  }

  /**
   * Polls GET /api/v1/3d/{id} until the model is `ready` or `failed` and
   * returns it either way (check `status`; a failed model carries `error` and
   * was refunded). Throws a `CarImageError` with status 408 when `timeoutMs`
   * (default 30 minutes) passes first; `intervalMs` defaults to 5 seconds.
   */
  async wait3dModel(id: string, options: WaitModel3dOptions & RequestOptions = {}): Promise<Model3d> {
    const { intervalMs = 5_000, timeoutMs = 1_800_000, onProgress, ...request } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("wait3dModel aborted");
      const { data } = await this.get3dModel(id, request);
      onProgress?.(data);
      if (data.status === "ready" || data.status === "failed") return data;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new CarImageError({
          status: 408,
          title: "Timed out waiting for the 3D model",
          detail: `Model ${id} is still ${data.status} (${data.progress}%) after ${Math.round(timeoutMs / 1000)} s. Keep polling get3dModel, or pass a webhookUrl when creating one.`,
        });
      }
      await this.sleep(Math.min(Math.max(1, intervalMs), remaining));
    }
  }

  /** GET /api/v1/vehicles?q= — public fuzzy search across makes and models. */
  async searchVehicles(
    query: string,
    options: { limit?: number; year?: number } & RequestOptions = {}
  ): Promise<VehicleSearchResponse> {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("query is required");
    const { limit, year, ...request } = options;
    const search = new URLSearchParams({ q: query.trim() });
    if (limit !== undefined) search.set("limit", String(limit));
    if (year !== undefined) search.set("year", String(normalizeYear(year)));
    const response = await this.send(`/api/v1/vehicles?${search}`, { ...request, auth: "optional" });
    return this.json<VehicleSearchResponse>(response);
  }

  // ------------------------------------------------------------- feedback

  /**
   * POST /api/v1/images/reports — free; file a tracked report that starts the
   * fix. `wrong_image` (category `identity`, `camera` or `paint`) and
   * `poor_quality` name a stored image by `assetId`, by the `requestId` that
   * delivered it, or by vehicle with `view` and `color`; `missing_vehicle`
   * names `make`, `model` and `year` only. A repeat from the same account on
   * the same image (or vehicle) folds into the open report: `created: false`
   * and the same `id`. Keep `data.id`: webhooks carry it as `report_id` with
   * your `externalRef`. `data.url` is the report's page, private to your account.
   */
  async reportImage(input: ImageReportInput, options: RequestOptions = {}): Promise<ImageReportResponse> {
    const response = await this.send("/api/v1/images/reports", {
      ...options,
      method: "POST",
      body: JSON.stringify(imageReportBody(input)),
    });
    return this.json<ImageReportResponse>(response);
  }

  /** GET /api/v1/images/reports/{id} — one of your image reports with its status now; another account's is a 404. */
  async getImageReport(id: string, options: RequestOptions = {}): Promise<ImageReportResponse> {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("report id is required");
    const response = await this.send(`/api/v1/images/reports/${encodeURIComponent(id.trim())}`, options);
    return this.json<ImageReportResponse>(response);
  }

  // -------------------------------------------------------------- requests

  /** GET /api/v1/requests — public board of vehicle and feature requests; `viewer.voted` is filled in when a key is sent. */
  async listRequests(params: ListRequestsParams = {}, options: RequestOptions = {}): Promise<RequestListResponse> {
    const search = new URLSearchParams();
    if (params.kind !== undefined) search.set("kind", params.kind);
    if (params.status !== undefined) search.set("status", params.status);
    if (params.sort !== undefined) search.set("sort", params.sort);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.cursor !== undefined && params.cursor !== "") search.set("cursor", params.cursor);
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/requests${query}`, { ...options, auth: "optional" });
    return this.json<RequestListResponse>(response);
  }

  /**
   * POST /api/v1/requests — free; ask for a missing vehicle (make + model, optional
   * year) or propose a feature (title, optional body). Resolves with
   * `deduplicated: true` when an identical open vehicle request already existed
   * and your vote was added to it instead.
   */
  async createRequest(input: CreateRequestInput, options: RequestOptions = {}): Promise<CreateRequestResponse> {
    const body: Record<string, unknown> = { kind: input.kind };
    if (input.kind === "vehicle") {
      const make = input.make?.trim();
      const model = input.model?.trim();
      if (!make || !model) throw new TypeError("a vehicle request needs make and model");
      body.make = make;
      body.model = model;
      if (input.year !== undefined && input.year !== "") body.year = normalizeYear(input.year);
      if (input.market !== undefined) body.market = normalizeMarket(input.market);
    } else if (input.kind === "feature") {
      const title = input.title?.trim();
      if (!title) throw new TypeError("a feature request needs a title");
      body.title = title;
    } else {
      throw new TypeError('kind must be "vehicle" or "feature"');
    }
    if (input.body !== undefined && input.body.trim()) body.body = input.body.trim();
    const response = await this.send("/api/v1/requests", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.json<CreateRequestResponse>(response);
  }

  /** GET /api/v1/requests/{id} — public; the request with its comment thread. */
  async getRequest(id: string, options: RequestOptions = {}): Promise<RequestDetailResponse> {
    const response = await this.send(`/api/v1/requests/${requestPath(id)}`, { ...options, auth: "optional" });
    return this.json<RequestDetailResponse>(response);
  }

  /** POST /api/v1/requests/{id}/votes — free, idempotent; adds your vote. */
  async voteRequest(id: string, options: RequestOptions = {}): Promise<RequestResponse> {
    const response = await this.send(`/api/v1/requests/${requestPath(id)}/votes`, { ...options, method: "POST", body: "{}" });
    return this.json<RequestResponse>(response);
  }

  /** DELETE /api/v1/requests/{id}/votes — removes your vote. */
  async unvoteRequest(id: string, options: RequestOptions = {}): Promise<RequestResponse> {
    const response = await this.send(`/api/v1/requests/${requestPath(id)}/votes`, { ...options, method: "DELETE" });
    return this.json<RequestResponse>(response);
  }

  /** GET /api/v1/requests/{id}/comments — public. */
  async listRequestComments(id: string, options: RequestOptions = {}): Promise<RequestCommentsResponse> {
    const response = await this.send(`/api/v1/requests/${requestPath(id)}/comments`, { ...options, auth: "optional" });
    return this.json<RequestCommentsResponse>(response);
  }

  /** POST /api/v1/requests/{id}/comments — free; add a comment to a request. */
  async commentOnRequest(id: string, body: string, options: RequestOptions = {}): Promise<RequestCommentResponse> {
    if (typeof body !== "string" || !body.trim()) throw new TypeError("comment body is required");
    const response = await this.send(`/api/v1/requests/${requestPath(id)}/comments`, {
      ...options,
      method: "POST",
      body: JSON.stringify({ body: body.trim() }),
    });
    return this.json<RequestCommentResponse>(response);
  }

  // -------------------------------------------------------------- feedback

  /** GET /api/v1/feedback — the public board: features, vehicles and published issues. `mine: true` (with a key) lists your own items and the ones you follow. */
  async listFeedback(params: ListRequestsParams = {}, options: RequestOptions = {}): Promise<RequestListResponse> {
    const search = new URLSearchParams();
    for (const key of ["kind", "status", "sort", "q", "cursor"] as const) {
      const value = params[key];
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.mine) search.set("mine", "true");
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/feedback${query}`, { ...options, auth: params.mine ? "required" : "optional" });
    return this.json<RequestListResponse>(response);
  }

  /** GET /api/v1/feedback?mine=true — your items (private issues included) and the ones you vote on, comment on or follow. */
  async listMyFeedback(params: Omit<ListRequestsParams, "mine"> = {}, options: RequestOptions = {}): Promise<RequestListResponse> {
    return this.listFeedback({ ...params, mine: true }, options);
  }

  /** GET /api/v1/feedback/{id} — one item with its comments and timeline (an issue's context only for its reporter). */
  async getFeedback(id: string, options: RequestOptions = {}): Promise<RequestDetailResponse> {
    const response = await this.send(`/api/v1/feedback/${requestPath(id)}`, { ...options, auth: "optional" });
    return this.json<RequestDetailResponse>(response);
  }

  /**
   * POST /api/v1/feedback/features — free; request a feature. When similar
   * items exist nothing is filed (`created: false`) and `similar` lists them:
   * upvote one with `upvoteFeedback`, or call again with `force: true`.
   */
  async requestFeature(input: RequestFeatureInput, options: RequestOptions = {}): Promise<FiledFeedbackResponse> {
    const title = input.title?.trim();
    if (!title) throw new TypeError("a feature request needs a title");
    const body: Record<string, unknown> = { title };
    if (input.body?.trim()) body.body = input.body.trim();
    if (input.force) body.force = true;
    const response = await this.send("/api/v1/feedback/features", { ...options, method: "POST", body: JSON.stringify(body) });
    return this.json<FiledFeedbackResponse>(response);
  }

  /**
   * POST /api/v1/feedback/issues — free; report a problem with the API,
   * private to you and the Car Image team. Pass the X-Request-Id of the call
   * that went wrong as `requestId`; without one, the last call this client saw
   * fail is attached (`attachLastError: false` turns that off). Similar open
   * reports come back first, as with `requestFeature`.
   */
  async reportIssue(input: ReportIssueInput, options: RequestOptions = {}): Promise<FiledFeedbackResponse> {
    const title = input.title?.trim();
    if (!title) throw new TypeError("an issue report needs a title");
    const context: IssueContext = { ...(input.context ?? {}) };
    const requestId = input.requestId?.trim() || context.request_id;
    const last = this.failure;
    if (!requestId && input.attachLastError !== false && last) {
      if (last.request_id) context.request_id = last.request_id;
      context.endpoint ??= last.endpoint;
      context.method ??= last.method;
      context.status ??= last.status;
      if (last.error_code) context.error_code ??= last.error_code;
    } else if (requestId) {
      context.request_id = requestId;
    }
    context.client ??= this.userAgent.split("/")[0];
    context.client_version ??= this.userAgent.split("/")[1]?.split(" ")[0];
    const body: Record<string, unknown> = { title, context };
    if (input.body?.trim()) body.body = input.body.trim();
    if (input.force) body.force = true;
    const response = await this.send("/api/v1/feedback/issues", { ...options, method: "POST", body: JSON.stringify(body) });
    return this.json<FiledFeedbackResponse>(response);
  }

  /** POST /api/v1/feedback/{id}/votes — free, idempotent; upvote and follow an item. */
  async upvoteFeedback(id: string, options: RequestOptions = {}): Promise<RequestResponse> {
    const response = await this.send(`/api/v1/feedback/${requestPath(id)}/votes`, { ...options, method: "POST", body: "{}" });
    return this.json<RequestResponse>(response);
  }

  /** DELETE /api/v1/feedback/{id}/votes — remove your vote (you stop following unless you commented). */
  async removeFeedbackVote(id: string, options: RequestOptions = {}): Promise<RequestResponse> {
    const response = await this.send(`/api/v1/feedback/${requestPath(id)}/votes`, { ...options, method: "DELETE" });
    return this.json<RequestResponse>(response);
  }

  /** POST /api/v1/feedback/{id}/comments — free; add a comment. */
  async commentOnFeedback(id: string, body: string, options: RequestOptions = {}): Promise<RequestCommentResponse> {
    if (typeof body !== "string" || !body.trim()) throw new TypeError("comment body is required");
    const response = await this.send(`/api/v1/feedback/${requestPath(id)}/comments`, { ...options, method: "POST", body: JSON.stringify({ body: body.trim() }) });
    return this.json<RequestCommentResponse>(response);
  }

  // --------------------------------------------------------------- reviews

  /** GET /api/v1/reviews — public; published reviews with the team's responses, and the average and distribution. */
  async listReviews(params: ListReviewsParams = {}, options: RequestOptions = {}): Promise<ReviewListResponse> {
    const search = new URLSearchParams();
    if (params.sort) search.set("sort", params.sort);
    if (params.rating !== undefined) search.set("rating", String(params.rating));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.cursor) search.set("cursor", params.cursor);
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/reviews${query}`, { ...options, auth: "optional" });
    return this.json<ReviewListResponse>(response);
  }

  /** GET /api/v1/reviews/me — your review with its moderation state, or `data: null`. */
  async getMyReview(options: RequestOptions = {}): Promise<ReviewResponse> {
    const response = await this.send("/api/v1/reviews/me", options);
    return this.json<ReviewResponse>(response);
  }

  /** PUT /api/v1/reviews/me — post or edit your review (rating 1-5); one edit an hour. */
  async submitReview(input: ReviewInput, options: RequestOptions = {}): Promise<ReviewResponse> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new TypeError("rating must be an integer from 1 to 5");
    const response = await this.send("/api/v1/reviews/me", { ...options, method: "PUT", body: JSON.stringify(input) });
    return this.json<ReviewResponse>(response);
  }

  // ------------------------------------------------------------- about you

  /** POST /api/v1/account/building — tell the team what you are building. Private: only the Car Image team sees it. */
  async shareBuilding(building: string, options: RequestOptions = {}): Promise<BuildingResponse> {
    if (typeof building !== "string" || !building.trim()) throw new TypeError("building is required");
    const response = await this.send("/api/v1/account/building", {
      ...options,
      method: "POST",
      body: JSON.stringify({ building: building.trim() }),
    });
    return this.json<BuildingResponse>(response);
  }

  /** POST /api/v1/account/referral — how you found the API (one of `REFERRAL_SOURCES`). Private to the team. */
  async shareReferral(source: ReferralSource, detail?: string, options: RequestOptions = {}): Promise<ReferralResponse> {
    if (!(REFERRAL_SOURCES as readonly string[]).includes(source)) {
      throw new RangeError(`source must be one of: ${REFERRAL_SOURCES.join(", ")}`);
    }
    const body: Record<string, unknown> = { source };
    if (detail !== undefined && detail.trim()) body.detail = detail.trim();
    const response = await this.send("/api/v1/account/referral", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.json<ReferralResponse>(response);
  }

  // -------------------------------------------------------------- account

  /** GET /api/v1/account — the plan, this month's vehicle images (`limits_usage`), credits, 30-day usage, key scopes. */
  async account(options: RequestOptions = {}): Promise<AccountResponse> {
    const response = await this.send("/api/v1/account", options);
    return this.json<AccountResponse>(response);
  }

  /**
   * GET /api/v1/account/campaigns — campaign tracking over `[from, to)`
   * (default: this UTC month so far): totals, pieces and requests by campaign
   * with the delivery-URL loads logged under each, and pieces by vehicle with
   * the campaigns that used it. Needs `account:read`; free.
   */
  async getCampaignUsage(params: CampaignUsageParams = {}, options: RequestOptions = {}): Promise<CampaignUsageResponse> {
    const search = new URLSearchParams();
    const from = usageBound(params.from, "from");
    const to = usageBound(params.to, "to");
    if (from !== undefined) search.set("from", from);
    if (to !== undefined) search.set("to", to);
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/account/campaigns${query}`, options);
    return this.json<CampaignUsageResponse>(response);
  }

  /** GET /api/v1/account/members — the organization's members and teams with their roles, read only. */
  async members(options: RequestOptions = {}): Promise<MembersResponse> {
    const response = await this.send("/api/v1/account/members", options);
    return this.json<MembersResponse>(response);
  }

  // ------------------------------------------------------------- webhooks

  /** GET /api/v1/webhooks — free; the account's webhook endpoints and which events it receives. */
  async listWebhooks(options: RequestOptions = {}): Promise<WebhookListResponse> {
    return this.json<WebhookListResponse>(await this.send("/api/v1/webhooks", options));
  }

  /**
   * POST /api/v1/webhooks — free; registers an https endpoint (at most ten per
   * account). `data.secret` (`whsec_…`) is returned once: store it to verify
   * deliveries with verifyWebhook(). Needs an API key, not a connected app.
   */
  async createWebhook(input: CreateWebhookInput, options: RequestOptions = {}): Promise<CreatedWebhookResponse> {
    const response = await this.send("/api/v1/webhooks", { ...options, method: "POST", body: JSON.stringify(input) });
    return this.json<CreatedWebhookResponse>(response);
  }

  /** GET /api/v1/webhooks/{id} — free; one endpoint. */
  async getWebhook(id: string, options: RequestOptions = {}): Promise<WebhookResponse> {
    return this.json<WebhookResponse>(await this.send(`/api/v1/webhooks/${requestPath(id)}`, options));
  }

  /** PATCH /api/v1/webhooks/{id} — free; change the URL, events, description, or turn it off and on (`status`). */
  async updateWebhook(id: string, input: UpdateWebhookInput, options: RequestOptions = {}): Promise<WebhookResponse> {
    const response = await this.send(`/api/v1/webhooks/${requestPath(id)}`, { ...options, method: "PATCH", body: JSON.stringify(input) });
    return this.json<WebhookResponse>(response);
  }

  /** DELETE /api/v1/webhooks/{id} — free; deletes the endpoint and its delivery history. */
  async deleteWebhook(id: string, options: RequestOptions = {}): Promise<DeletedWebhookResponse> {
    return this.json<DeletedWebhookResponse>(await this.send(`/api/v1/webhooks/${requestPath(id)}`, { ...options, method: "DELETE" }));
  }

  /** POST /api/v1/webhooks/{id}/test — free on every plan; queues a signed `webhook.test` event to that endpoint only. */
  async testWebhook(id: string, options: RequestOptions = {}): Promise<WebhookTestResponse> {
    return this.json<WebhookTestResponse>(await this.send(`/api/v1/webhooks/${requestPath(id)}/test`, { ...options, method: "POST", body: "{}" }));
  }

  /** GET /api/v1/webhooks/{id}/deliveries — free; the endpoint's newest deliveries (`limit` 1–100, default 50). */
  async listWebhookDeliveries(id: string, options: { limit?: number } & RequestOptions = {}): Promise<WebhookDeliveriesResponse> {
    const { limit, ...request } = options;
    const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return this.json<WebhookDeliveriesResponse>(await this.send(`/api/v1/webhooks/${requestPath(id)}/deliveries${query}`, request));
  }

  /** GET /api/v1/events — free; the account's webhook events of the last 30 days, oldest first, to poll instead of (or beside) endpoints. */
  async listEvents(params: ListEventsParams = {}, options: RequestOptions = {}): Promise<EventListResponse> {
    const search = new URLSearchParams();
    if (params.type) search.set("type", params.type);
    if (params.since) search.set("since", params.since instanceof Date ? params.since.toISOString() : params.since);
    if (params.startingAfter) search.set("starting_after", params.startingAfter);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    const query = search.size ? `?${search}` : "";
    return this.json<EventListResponse>(await this.send(`/api/v1/events${query}`, options));
  }

  // ---------------------------------------------------------------- image packs

  /** GET /api/v1/packs — free; the account's Image Packs, and `offers` it may buy (each with a checkout_url for the human). */
  async listPacks(options: RequestOptions = {}): Promise<PackListResponse> {
    return this.json<PackListResponse>(await this.send("/api/v1/packs", options));
  }

  /** GET /api/v1/packs/{id} — free; balance, window and recent batches. */
  async getPack(id: string, options: RequestOptions = {}): Promise<PackResponse> {
    return this.json<PackResponse>(await this.send(`/api/v1/packs/${requestPath(id)}`, options));
  }

  /** POST /api/v1/packs/quote — free; how many images are stored, how many need drawing, the wait, and the smallest pack that holds them (`unit: "vehicle"` quotes a Vehicle Pack: every view of each vehicle). */
  async quotePack(items: PackBatchItemInput[], quality?: PackQuality, options: { unit?: PackUnit } & MarketOption & RequestOptions = {}): Promise<PackQuoteResponse> {
    const { unit, market, ...request } = options;
    const body = { items, ...(quality ? { quality } : {}), ...(unit ? { unit } : {}), ...(market === undefined ? {} : { market: normalizeMarket(market) }) };
    return this.json<PackQuoteResponse>(await this.send("/api/v1/packs/quote", { ...request, method: "POST", body: JSON.stringify(body) }));
  }

  /**
   * POST /api/v1/packs/{id}/batches — free; each new vehicle view uses one of
   * the pack's images. With `allowPartial: true`, queue the matched vehicles
   * and return refused rows. Otherwise any refusal returns 422 before queuing.
   * Every call carries an `Idempotency-Key`, so a retry
   * returns the first batch. Webhooks (`image.ready`, `pack.batch.completed`)
   * say when each car is ready; or poll `getPackBatch`.
   */
  async createPackBatch(packId: string, input: PackBatchInput, options: { idempotencyKey?: string } & RequestOptions = {}): Promise<CreatedPackBatchResponse> {
    const { idempotencyKey, ...request } = options;
    const body: Record<string, unknown> = { items: input.items };
    if (input.allowPartial !== undefined) body.allow_partial = input.allowPartial;
    if (input.quality) body.quality = input.quality;
    if (input.market !== undefined) body.market = normalizeMarket(input.market);
    if (input.webhookUrl !== undefined) body.webhook_url = input.webhookUrl;
    if (input.webhookSecret !== undefined) body.webhook_secret = input.webhookSecret;
    const key = idempotencyKey ?? generateIdempotencyKey();
    const headers: Record<string, string> = { ...request.headers };
    if (key) headers["Idempotency-Key"] = key;
    const response = await this.send(`/api/v1/packs/${requestPath(packId)}/batches`, { ...request, headers, method: "POST", body: JSON.stringify(body) });
    return this.json<CreatedPackBatchResponse>(response);
  }

  /** GET /api/v1/packs/{id}/batches/{batch_id} — free; state and items in request order (`limit` 1–500, `after` for the next page). */
  async getPackBatch(packId: string, batchId: string, options: { limit?: number; after?: number } & RequestOptions = {}): Promise<PackBatchResponse> {
    const { limit, after, ...request } = options;
    const search = new URLSearchParams();
    if (limit !== undefined) search.set("limit", String(limit));
    if (after !== undefined) search.set("after", String(after));
    const query = search.size ? `?${search}` : "";
    return this.json<PackBatchResponse>(await this.send(`/api/v1/packs/${requestPath(packId)}/batches/${requestPath(batchId)}${query}`, request));
  }

  /** GET /api/v1/packs/{id}/manifest — free; every delivered image, with the SHA-256 of its bytes, its download URL and whether those bytes are verified. */
  async getPackManifest(packId: string, options: RequestOptions = {}): Promise<PackManifestResponse> {
    return this.json<PackManifestResponse>(await this.send(`/api/v1/packs/${requestPath(packId)}/manifest`, options));
  }

  /** GET /api/v1/packs/{id}/manifest?format=csv — free; the same as CSV text. */
  async getPackManifestCsv(packId: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.send(`/api/v1/packs/${requestPath(packId)}/manifest?format=csv`, { ...options, accept: "text/csv, application/problem+json;q=0.8" });
    return response.text();
  }

  /** GET /api/v1/packs/{id}/images/{item_id} — free; one delivered image in any color, size and format. */
  async downloadPackImage(packId: string, itemId: string, image: PackImageOptions = {}, options: RequestOptions = {}): Promise<PackImageResult> {
    const search = new URLSearchParams();
    if (image.color !== undefined) search.set("color", image.color);
    if (image.width !== undefined) search.set("w", String(image.width));
    if (image.height !== undefined) search.set("h", String(image.height));
    if (image.format !== undefined) search.set("format", image.format);
    if (image.fit !== undefined) search.set("fit", image.fit);
    if (image.background !== undefined) search.set("background", image.background);
    if (image.trim !== undefined) search.set("trim", String(image.trim));
    if (image.shadow !== undefined) search.set("shadow", String(image.shadow));
    const query = search.size ? `?${search}` : "";
    const response = await this.send(`/api/v1/packs/${requestPath(packId)}/images/${requestPath(itemId)}${query}`, {
      ...options,
      accept: "image/png, image/webp, image/jpeg, image/*;q=0.9, application/problem+json;q=0.8",
    });
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      source: response.headers.get("x-image-source") === "archive" ? "archive" : "live",
    };
  }

  /** POST /api/v1/packs/{id}/exports — free, 10 a month; ZIP files of every delivered image, built in the background (`pack.export.ready`). */
  async createPackExport(packId: string, input: PackExportInput = {}, options: RequestOptions = {}): Promise<PackExportResponse> {
    return this.json<PackExportResponse>(await this.send(`/api/v1/packs/${requestPath(packId)}/exports`, { ...options, method: "POST", body: JSON.stringify(input) }));
  }

  /** GET /api/v1/packs/{id}/exports/{export_id} — free; progress and, once ready, a signed link per ZIP part (7 days). */
  async getPackExport(packId: string, exportId: string, options: RequestOptions = {}): Promise<PackExportResponse> {
    return this.json<PackExportResponse>(await this.send(`/api/v1/packs/${requestPath(packId)}/exports/${requestPath(exportId)}`, options));
  }

  /**
   * POST /api/v1/billing/checkout with a plan — hosted Stripe Checkout for Pro or
   * Business (scope billing:write), or an in-place switch for an account already
   * on a Stripe plan, which can immediately invoice a proration. Prefer
   * createCheckoutLink for a link-only flow with browser confirmation.
   */
  async createPlanCheckout(plan: "starter" | "pro" | "business", interval: PlanInterval = "month", options: RequestOptions = {}): Promise<PlanCheckoutResponse> {
    if (plan !== "pro" && plan !== "business") throw new RangeError('plan must be "pro" or "business"');
    if (interval !== "month" && interval !== "year") throw new RangeError('interval must be "month" or "year"');
    const response = await this.send("/api/v1/billing/checkout", {
      ...options,
      method: "POST",
      body: JSON.stringify({ plan, interval }),
    });
    return this.json<PlanCheckoutResponse>(response);
  }

  /** POST /api/v1/billing/portal — Stripe Customer Portal URL (scope billing:write). */
  async billingPortal(options: RequestOptions = {}): Promise<PortalResponse> {
    const response = await this.send("/api/v1/billing/portal", { ...options, method: "POST", body: "{}" });
    return this.json<PortalResponse>(response);
  }

  /** The public pricing document: plans, their vehicle images, Image Packs and the live 3D cost. Credits are not sold. */
  async pricing(options: RequestOptions = {}): Promise<PricingResponse> {
    return this.json<PricingResponse>(await this.send("/api/v1/pricing", { ...options, auth: "none" }));
  }

  /** Product help. Queries are recorded privately; send no secrets or customer email text. */
  async searchHelp(query: string, options: RequestOptions & { reportGap?: boolean } = {}): Promise<HelpResponse> {
    if (query.trim().length < 2 || query.trim().length > 1000) throw new RangeError("query must be 2–1000 characters");
    const body = { query: query.trim(), ...(options.reportGap ? { report_gap: true } : {}) };
    return this.json<HelpResponse>(await this.send("/api/v1/help", { ...options, method: "POST", body: JSON.stringify(body) }));
  }

  /**
   * A plan's purchase link, without charging or switching the account's
   * plan. Credits are no longer sold (2026-10-25): a plan includes them every
   * month, and an Image Pack (`quotePack`, `/pricing#packs`) buys a set of
   * images to keep.
   */
  async createCheckoutLink(input: CheckoutLinkInput, options: RequestOptions = {}): Promise<BillingLinkResponse> {
    if ("credits" in (input as object)) throw new RangeError("Credits are no longer sold; pass a plan (pro or business), or buy an Image Pack");
    if (input.plan !== "pro" && input.plan !== "business") throw new RangeError("Unknown plan");
    if (input.interval !== undefined && (!input.plan || !["month", "year"].includes(input.interval))) throw new RangeError("interval requires a plan and must be month or year");
    const body = input;
    return this.json<BillingLinkResponse>(await this.send("/api/v1/billing/link", { ...options, method: "POST", body: JSON.stringify(body) }));
  }

  /** Private Stripe portal for billing-scoped owner keys; signed-in dashboard for connected apps. */
  async getBillingLink(options: RequestOptions = {}): Promise<BillingLinkResponse> {
    return this.json<BillingLinkResponse>(await this.send("/api/v1/billing/link", { ...options, method: "POST", body: "{}" }));
  }

  // ------------------------------------------------- agent purchases (Tier 3)

  /**
   * POST /api/v1/billing/purchase — buys Pro or Business with a Stripe Shared
   * Payment Token, within the owner's agent spending limit (scope
   * billing:purchase). CHARGES MONEY unless `dryRun`: quote first and confirm
   * the amount. `idempotencyKey` is required for a paid call; reuse it to
   * retry. Refusals throw a CarImageError whose problem carries `code` and
   * `checkout_url`.
   */
  async purchasePlan(input: PurchasePlanInput, options: RequestOptions = {}): Promise<AgentPurchaseResponse> {
    if (input.plan !== "pro" && input.plan !== "business") throw new RangeError("plan must be pro or business");
    if (!/^spt_[A-Za-z0-9_]{8,255}$/.test(input.paymentToken)) throw new RangeError("paymentToken must be a Stripe Shared Payment Token (spt_…); never a card number");
    const key = input.idempotencyKey ?? (input.dryRun ? undefined : generateIdempotencyKey() ?? undefined);
    const body = {
      plan: input.plan,
      interval: input.interval ?? "month",
      payment: { type: "shared_payment_token", token: input.paymentToken },
      ...(input.maxAmount !== undefined ? { max_amount: input.maxAmount } : {}),
      ...(input.dryRun ? { dry_run: true } : {}),
    };
    const headers: Record<string, string> = { ...(options.headers ?? {}), ...(key ? { "Idempotency-Key": key } : {}) };
    return this.json<AgentPurchaseResponse>(await this.send("/api/v1/billing/purchase", { ...options, headers, method: "POST", body: JSON.stringify(body) }));
  }

  /** POST /api/v1/billing/invoices/{id}/pay — pays an open plan invoice (a renewal) with a fresh payment token, within the agent spending limit. */
  async payInvoice(invoiceId: string, input: Omit<PurchasePlanInput, "plan" | "interval">, options: RequestOptions = {}): Promise<AgentPurchaseResponse> {
    if (!/^in_[A-Za-z0-9]{8,255}$/.test(invoiceId)) throw new RangeError("invoiceId must be a Stripe invoice id (in_…)");
    if (!/^spt_[A-Za-z0-9_]{8,255}$/.test(input.paymentToken)) throw new RangeError("paymentToken must be a Stripe Shared Payment Token (spt_…); never a card number");
    const key = input.idempotencyKey ?? (input.dryRun ? undefined : generateIdempotencyKey() ?? undefined);
    const body = {
      payment: { type: "shared_payment_token", token: input.paymentToken },
      ...(input.maxAmount !== undefined ? { max_amount: input.maxAmount } : {}),
      ...(input.dryRun ? { dry_run: true } : {}),
    };
    const headers: Record<string, string> = { ...(options.headers ?? {}), ...(key ? { "Idempotency-Key": key } : {}) };
    return this.json<AgentPurchaseResponse>(await this.send(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/pay`, { ...options, headers, method: "POST", body: JSON.stringify(body) }));
  }

  /** GET /api/v1/billing/checkout/{session_id} — the state of a hosted Checkout session this account created, to poll until `complete`. */
  async checkoutStatus(sessionId: string, options: RequestOptions = {}): Promise<CheckoutStatusResponse> {
    return this.json<CheckoutStatusResponse>(await this.send(`/api/v1/billing/checkout/${encodeURIComponent(sessionId)}`, options));
  }

  /** GET /api/v1/billing/agent-limit — the owner's monthly agent spending limit and what is used. */
  async agentLimit(options: RequestOptions = {}): Promise<AgentLimitResponse> {
    return this.json<AgentLimitResponse>(await this.send("/api/v1/billing/agent-limit", options));
  }

  /** POST /api/v1/billing/agent-limit — lowers the limit (an API key can never raise it; the owner does, in the dashboard). */
  async lowerAgentLimit(monthlyCents: number, options: RequestOptions = {}): Promise<AgentLimitResponse> {
    return this.json<AgentLimitResponse>(await this.send("/api/v1/billing/agent-limit", { ...options, method: "POST", body: JSON.stringify({ monthly_cents: monthlyCents }) }));
  }

  /** DELETE /api/v1/billing/agent-limit — removes the limit: agents get checkout links again. */
  async clearAgentLimit(options: RequestOptions = {}): Promise<AgentLimitResponse> {
    return this.json<AgentLimitResponse>(await this.send("/api/v1/billing/agent-limit", { ...options, method: "DELETE" }));
  }

  // ----------------------------------------------------------------- meta

  /** GET /api/health — public. */
  async health(options: RequestOptions = {}): Promise<HealthResponse> {
    const response = await this.send("/api/health", { ...options, auth: "none" });
    return this.json<HealthResponse>(response);
  }

  /** GET /openapi.json — public machine-readable contract. */
  async openapi(options: RequestOptions = {}): Promise<OpenApiDocument> {
    const response = await this.send("/openapi.json", { ...options, auth: "none" });
    return this.json<OpenApiDocument>(response);
  }

  /** POST /api/auth/device/code — start browser-assisted login (public). */
  async startDeviceLogin(
    input: { clientName?: string } = {},
    options: RequestOptions = {}
  ): Promise<DeviceCodeResponse> {
    const response = await this.send("/api/auth/device/code", {
      ...options,
      method: "POST",
      auth: "none",
      body: JSON.stringify(input.clientName ? { client_name: input.clientName } : {}),
    });
    return this.json<DeviceCodeResponse>(response);
  }

  /** POST /api/auth/device/token — one poll; returns pending/expired/approved without throwing. */
  async pollDeviceLogin(deviceCode: string, options: RequestOptions = {}): Promise<DeviceTokenResult> {
    const response = await this.rawSend("/api/auth/device/token", {
      ...options,
      method: "POST",
      auth: "none",
      retries: 0,
      body: JSON.stringify({ device_code: deviceCode }),
    });
    if (response.ok) {
      const token = (await response.json()) as { access_token: string; token_type?: string; scope?: string };
      return {
        status: "approved",
        accessToken: token.access_token,
        tokenType: token.token_type ?? "Bearer",
        scope: token.scope ?? "",
      };
    }
    if (response.status === 400 || response.status === 428) {
      let code = "";
      try {
        const body = (await response.clone().json()) as { error?: string };
        code = body.error ?? "";
      } catch {
        code = "";
      }
      if (code === "authorization_pending" || code === "slow_down") return { status: "pending" };
      if (code === "expired_token") return { status: "expired" };
    }
    throw await CarImageError.fromResponse(response);
  }

  /** POST /api/v1/events — anonymous telemetry; public, never retried. */
  async trackEvents(events: TelemetryEvent[], options: RequestOptions = {}): Promise<void> {
    if (events.length === 0) return;
    await this.send("/api/v1/events", {
      ...options,
      method: "POST",
      auth: "none",
      retries: 0,
      body: JSON.stringify({ events }),
    });
  }

  /**
   * Authenticated raw fetch for anything not covered above. No retries, no
   * throwing on HTTP errors. The `Authorization` header is only attached when
   * the target shares the client's origin, so a foreign URL never sees the key.
   */
  async fetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(pathOrUrl);
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("User-Agent", this.userAgent);
    if (this.apiKey && !headers.has("authorization") && this.sameOrigin(url)) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    return this.fetchImpl(url, { ...init, headers });
  }

  // ------------------------------------------------------------ internals

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  private sameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }

  /** `sleep`, ended early (rejecting with the signal's reason) when `signal` aborts. */
  private async sleepUnlessAborted(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) return this.sleep(ms);
    signal.throwIfAborted();
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async json<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  private signalFor(options: RequestOptions): AbortSignal | undefined {
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const timeoutSignal =
      timeout !== undefined && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeout) : undefined;
    if (options.signal && timeoutSignal) {
      const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
      return typeof any === "function" ? any([options.signal, timeoutSignal]) : options.signal;
    }
    return options.signal ?? timeoutSignal;
  }

  /** Sends and throws `CarImageError` on any non-2xx response. */
  private async send(path: string, options: SendOptions = {}): Promise<Response> {
    const response = await this.rawSend(path, options);
    if (response.ok) return response;
    const error = await CarImageError.fromResponse(response);
    if (!path.startsWith("/api/v1/feedback/issues")) {
      const code = (error.problem as { code?: unknown } | null)?.code;
      this.failure = {
        request_id: error.requestId,
        endpoint: path.split("?")[0] ?? path,
        method: options.method ?? "GET",
        status: error.status,
        error_code: typeof code === "string" ? code : null,
        at: new Date().toISOString(),
      };
    }
    throw error;
  }

  /** Sends with retries but returns the final response, whatever its status. */
  private async rawSend(path: string, options: SendOptions = {}): Promise<Response> {
    const method = options.method ?? "GET";
    const auth = options.auth ?? "required";
    const headers = new Headers(options.headers);
    headers.set("Accept", options.accept ?? "application/json");
    if (!headers.has("user-agent") && !options.simple) headers.set("User-Agent", this.userAgent);
    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    if (this.apiKey) {
      if (auth !== "none") headers.set("Authorization", `Bearer ${this.apiKey}`);
    } else if (auth === "required") {
      throw new CarImageError({
        status: 401,
        title: "API key required",
        detail:
          "Create the client with { apiKey } or set CAR_IMAGE_API_KEY. Get a key at https://carimage.dev/dashboard?ref=sdk or run `npx @meterapp/car-image login`.",
      });
    }

    const retries = Math.max(0, options.retries ?? this.maxRetries);
    const url = this.url(path);
    // A POST under an Idempotency-Key, or one that reads and changes nothing, is as safe to repeat as a GET.
    const idempotent = method === "GET" || method === "HEAD" || options.readOnly === true || headers.has("idempotency-key");

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body,
          signal: this.signalFor(options),
          ...(options.redirect ? { redirect: options.redirect } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt < retries && idempotent) {
          await this.sleep(backoffDelayMs(attempt, this.retryBaseDelayMs, this.maxRetryDelayMs));
          continue;
        }
        throw new CarImageError({
          status: 0,
          title: "Network error",
          detail: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }

      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt >= retries) {
        return response;
      }
      // A Retry-After longer than maxRetryDelayMs is not retried: the error
      // carries retryAfterSeconds so the caller decides (#72).
      const delay = retryDelayMs(response.headers.get("retry-after"), attempt, {
        baseMs: this.retryBaseDelayMs,
        maxMs: this.maxRetryDelayMs,
      });
      if (delay === null) return response;
      try {
        await response.body?.cancel();
      } catch {
        // Body already consumed or not cancellable; nothing to release.
      }
      await this.sleep(delay);
    }
  }
}
