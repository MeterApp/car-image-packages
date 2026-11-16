import { isCarImageError, type CarImageError } from "@meterapp/car-image-sdk";

/** Exit codes: 0 success, 1 failure, 2 usage error. */
export type ExitCode = 0 | 1 | 2;

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: ExitCode = 1, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/** Picks the hint printed under an API error from its status. */
export type FixHint = (status: number | null | undefined, retryAfterSeconds?: number | null) => string | undefined;

/** "8h 12m", "14m", "45s": a Retry-After a person can read. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.ceil((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : m === 60 ? `${h + 1}h` : `${h}h ${m}m`;
}

/** Actionable next step for an API status code. */
export function fixHintFor(status: number | null | undefined, retryAfterSeconds?: number | null): string | undefined {
  switch (status) {
    case 401:
      return "Run `car-image login` (or set CAR_IMAGE_API_KEY) to authenticate.";
    case 402:
      return "Nothing was charged. A plan allowance is used up (it resets on the 1st, UTC; images already received keep serving) or the account lacks credits for a 3D model or logo: `car-image upgrade --plan pro|business`, or an Image Pack (`car-image packs`); human approval required.";
    case 403:
      return "This key lacks the required scope. Create a key with the right scopes in the dashboard, or run `car-image login` for a CLI key.";
    case 404:
      return "Vehicle not in the catalog? Try `car-image search <make model>` or `car-image resolve <free text>`.";
    case 429:
      return `Rate limited. Wait ${retryAfterSeconds ?? "a few"} seconds and retry.`;
    case 0:
      return "Network problem. Check connectivity and --base-url / CAR_IMAGE_API_URL.";
    case 502:
      return "The render failed; nothing was counted, and any credit it took was refunded. Retry shortly.";
    case 503:
      return retryAfterSeconds != null && retryAfterSeconds > 60
        ? `Temporarily unavailable (for example new renders are at the day's capacity); nothing was charged. Try again in ${formatWait(retryAfterSeconds)}.`
        : `Temporarily unavailable; nothing was charged. Wait ${retryAfterSeconds ?? "a few"} seconds and retry.`;
    default:
      return undefined;
  }
}

export interface RenderedError {
  message: string;
  hint?: string;
  requestId?: string | null;
  exitCode: ExitCode;
  status?: number;
}

/** Turns any thrown value into a user-facing message, hint and exit code; `hintFor` is the command's own hint, if it has one. */
export function describeError(error: unknown, hintFor: FixHint = fixHintFor): RenderedError {
  if (error instanceof CliError) {
    return { message: error.message, hint: error.hint, exitCode: error.exitCode };
  }
  if (isCarImageError(error)) {
    const typed: CarImageError = error;
    return {
      message: `${typed.title}: ${typed.detail}`,
      hint: hintFor(typed.status, typed.retryAfterSeconds),
      requestId: typed.requestId,
      exitCode: 1,
      status: typed.status,
    };
  }
  if (error instanceof Error) {
    return { message: error.message || error.name, exitCode: 1 };
  }
  return { message: String(error), exitCode: 1 };
}
