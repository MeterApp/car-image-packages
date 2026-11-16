/**
 * A real catalog vehicle a vehicle 404 suggests instead of what was sent
 * (`/docs/vehicles#missing`): retry with `vehicle: id`, or show it to a user.
 * `model`, `id` and `image_path` are null for a make-only suggestion.
 */
export interface VehicleSuggestion {
  make: string;
  make_name: string;
  model: string | null;
  model_name: string | null;
  year: number;
  id: string | null;
  image_path: string | null;
}

/** RFC 9457 problem details as sent by the API (`application/problem+json`). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  request_id?: string;
  /**
   * Rejected input field. An unknown query parameter is named as sent (cut to
   * 40 characters); an unknown JSON field is `image`. Never a value.
   */
  parameter?: string | null;
  /**
   * 400 for an unknown query parameter: every name the endpoint reads, by its
   * documented name (see `IMAGE_QUERY_ALIASES` for the other spellings).
   */
  allowed?: string[];
  /** False means fix the input; do not retry the same request. */
  retryable?: boolean;
  /** Vehicle misses: free catalog search and guidance for skipping variants. */
  search?: string;
  next_step?: string;
  /**
   * What a refusal is: on a 402, `plan_image_limit` (the month's vehicle
   * images are used), `subscription_required_for_credits` (not enough credits for a
   * 3D model, a logo or an upgrade; credits are not sold) or
   * `plan_vehicle_limit` (the legacy credit meter's distinct-vehicle cap).
   */
  code?: string;
  /** 402 for credits: the balance and what the request needed. */
  balance?: number;
  required_credits?: number;
  /** 402 `plan_image_limit`: the plan, this month's use, the allowance and how many more the request named. */
  plan?: string;
  used?: number;
  included?: number;
  requested?: number;
  /** When the monthly allowance resets (the 1st, UTC); null on Free's own allowance, one per account since 2026-11-11, which does not reset. */
  resets_at?: string | null;
  /** Image Packs: a one-time set of images to keep and self-host. */
  pack_url?: string;
  /** The next plan's Checkout (it signs the human in first; opening it charges nothing); null on Enterprise or under an agreement. */
  checkout_url?: string | null;
  /** Vehicle 404s: the catalog endpoint (`/api/v1/vehicles`). */
  catalog?: string;
  /** Vehicle 404s: up to five real catalog vehicles closest to the request, most useful first. */
  suggestions?: VehicleSuggestion[];
  [key: string]: unknown;
}

export interface CarImageErrorInit {
  status: number;
  title: string;
  detail: string;
  requestId?: string | null;
  problem?: ProblemDetails | null;
  retryAfterSeconds?: number | null;
  headers?: Headers | null;
  cause?: unknown;
}

/**
 * Every failure surfaced by the SDK. `status` is the HTTP status (0 for network
 * failures), `detail` is the human-readable explanation from the server and
 * `requestId` lets support trace the call.
 */
export class CarImageError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly requestId: string | null;
  readonly problem: ProblemDetails | null;
  readonly retryAfterSeconds: number | null;
  readonly headers: Headers | null;

  constructor(init: CarImageErrorInit) {
    const suffix = init.requestId ? ` (request ${init.requestId})` : "";
    super(`${init.title}: ${init.detail}${suffix}`, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "CarImageError";
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId ?? null;
    this.problem = init.problem ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.headers = init.headers ?? null;
  }

  /** Builds an error from a non-2xx response, reading problem+json when present. */
  static async fromResponse(response: Response): Promise<CarImageError> {
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }
    let problem: ProblemDetails | null = null;
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          problem = parsed as ProblemDetails;
        }
      } catch {
        problem = null;
      }
    }
    const title =
      (typeof problem?.title === "string" && problem.title) ||
      (response.statusText ? response.statusText : `HTTP ${response.status}`);
    const detail =
      (typeof problem?.detail === "string" && problem.detail) ||
      (typeof problem?.error === "string" && problem.error) ||
      (text && !problem ? text.slice(0, 300) : `The server responded with HTTP ${response.status}.`);
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
    return new CarImageError({
      status: response.status,
      title,
      detail,
      requestId:
        (typeof problem?.request_id === "string" && problem.request_id) ||
        response.headers.get("x-request-id") ||
        null,
      problem,
      retryAfterSeconds,
      headers: response.headers,
    });
  }

  /**
   * 402: nothing was charged. A plan allowance (`isPlanLimit`) resets on the
   * 1st (UTC) or needs a higher plan or an Image Pack; a credit shortfall
   * (3D models, logos, upgrades) needs a plan's monthly credits. Never
   * retried automatically. The name predates the vehicle-image meter: it is
   * true for every 402.
   */
  get isInsufficientCredits(): boolean {
    return this.status === 402;
  }

  /** 402 for a plan allowance: `plan_image_limit` or `plan_vehicle_limit`. */
  get isPlanLimit(): boolean {
    return this.status === 402 && typeof this.problem?.code === "string" && this.problem.code.startsWith("plan_");
  }

  /** 429: honor `retryAfterSeconds`. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** 401 or 403. */
  get isAuthentication(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 0 (network), 429 or 503. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status === 503;
  }

  toJSON(): ProblemDetails {
    return {
      ...(this.problem ?? {}),
      status: this.status,
      title: this.title,
      detail: this.detail,
      request_id: this.requestId ?? undefined,
    };
  }
}

export function isCarImageError(error: unknown): error is CarImageError {
  return error instanceof CarImageError || (error instanceof Error && error.name === "CarImageError");
}
