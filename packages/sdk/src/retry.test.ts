import { describe, expect, it } from "vitest";
import { backoffDelayMs, parseRetryAfter, retryDelayMs } from "./retry.js";

describe("parseRetryAfter", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfter("7")).toBe(7);
    expect(parseRetryAfter(" 12 ")).toBe(12);
  });

  it("reads HTTP dates relative to now", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(parseRetryAfter("Wed, 02 Sep 2026 12:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Wed, 02 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("returns null for missing or garbage values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("backoffDelayMs", () => {
  it("applies full jitter within an exponential ceiling", () => {
    expect(backoffDelayMs(0, 500, 30_000, () => 1)).toBe(500);
    expect(backoffDelayMs(1, 500, 30_000, () => 1)).toBe(1000);
    expect(backoffDelayMs(2, 500, 30_000, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(10, 500, 30_000, () => 1)).toBe(30_000);
    expect(backoffDelayMs(3, 500, 30_000, () => 0)).toBe(0);
  });
});

describe("retryDelayMs", () => {
  it("waits exactly the Retry-After the server asked for, up to the cap", () => {
    expect(retryDelayMs("2", 0, { baseMs: 500, maxMs: 30_000 })).toBe(2000);
    expect(retryDelayMs("30", 0, { baseMs: 500, maxMs: 30_000 })).toBe(30_000);
    expect(retryDelayMs(null, 1, { baseMs: 500, maxMs: 30_000, random: () => 1 })).toBe(1000);
  });

  it("does not retry when Retry-After is longer than the cap (#72)", () => {
    // A capacity refusal: "come back in 8 hours" must not be retried in 30 s.
    expect(retryDelayMs("30000", 0, { baseMs: 500, maxMs: 30_000 })).toBeNull();
    expect(retryDelayMs("31", 0, { baseMs: 500, maxMs: 30_000 })).toBeNull();
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(retryDelayMs("Thu, 03 Sep 2026 00:00:00 GMT", 0, { baseMs: 500, maxMs: 30_000, nowMs: now })).toBeNull();
  });
});
