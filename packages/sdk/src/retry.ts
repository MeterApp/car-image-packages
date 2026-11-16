/** Statuses that mean "the server did not process this; try again shortly". */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/**
 * Parses a `Retry-After` header into seconds. Accepts delay-seconds or an
 * HTTP-date. Returns `null` when absent or unparsable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

/**
 * Full-jitter exponential backoff: a random delay in `[0, min(max, base * 2^attempt)]`.
 * `attempt` is zero-based.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

/**
 * Delay before the next attempt, honoring `Retry-After` when the server sent
 * one. Returns `null` when the server asks for a longer wait than `maxMs`:
 * retrying sooner than it said would only be refused again (a capacity
 * refusal says "come back at the next UTC midnight"), so the caller should
 * surface the error, whose `retryAfterSeconds` says when, instead.
 */
export function retryDelayMs(
  retryAfterHeader: string | null | undefined,
  attempt: number,
  options: { baseMs: number; maxMs: number; nowMs?: number; random?: () => number }
): number | null {
  const retryAfter = parseRetryAfter(retryAfterHeader, options.nowMs);
  if (retryAfter !== null) return retryAfter * 1000 > options.maxMs ? null : retryAfter * 1000;
  return backoffDelayMs(attempt, options.baseMs, options.maxMs, options.random);
}
