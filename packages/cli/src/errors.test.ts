import { describe, expect, it } from "vitest";
import { fixHintFor, formatWait } from "./errors.js";

describe("fixHintFor", () => {
  it("tells a failed render (502) from a capacity refusal (503) and prints the wait (#72)", () => {
    expect(fixHintFor(502)).toContain("refunded");
    expect(fixHintFor(503, 29_520)).toContain("Try again in 8h 12m");
    expect(fixHintFor(503, 5)).toContain("Wait 5 seconds");
    expect(fixHintFor(503)).toContain("Wait a few seconds");
  });
});

describe("formatWait", () => {
  it("reads like a person would say it", () => {
    expect(formatWait(45)).toBe("45s");
    expect(formatWait(840)).toBe("14m");
    expect(formatWait(7200)).toBe("2h");
    expect(formatWait(7199)).toBe("2h");
    expect(formatWait(29_520)).toBe("8h 12m");
  });
});
