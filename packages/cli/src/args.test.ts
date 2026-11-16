import { describe, expect, it } from "vitest";
import { flagChoice, flagInteger, flagString, parseArgs, requireString } from "./args.js";
import { CliError } from "./errors.js";

describe("parseArgs", () => {
  it("separates the command, positionals and flags", () => {
    const parsed = parseArgs(["get", "--make", "Porsche", "--model=911", "--year", "2024", "--json", "--out", "car.png"]);
    expect(parsed.command).toBe("get");
    expect(parsed.positionals).toEqual([]);
    expect(parsed.flags).toEqual({ make: "Porsche", model: "911", year: "2024", json: true, out: "car.png" });
  });

  it("keeps free text after the command as positionals", () => {
    const parsed = parseArgs(["resolve", "red", "2024", "porsche", "911", "side", "view", "--json"]);
    expect(parsed.command).toBe("resolve");
    expect(parsed.positionals).toEqual(["red", "2024", "porsche", "911", "side", "view"]);
    expect(parsed.flags.json).toBe(true);
  });

  it("supports --no-flag, short flags and -- to stop parsing", () => {
    const parsed = parseArgs(["login", "--no-browser", "-q", "-o", "file.png", "--", "--not-a-flag"]);
    expect(parsed.flags).toEqual({ browser: false, quiet: true, out: "file.png" });
    expect(parsed.positionals).toEqual(["--not-a-flag"]);
    expect(parseArgs(["-v"]).flags.version).toBe(true);
    expect(parseArgs(["-h"]).flags.help).toBe(true);
  });

  it("never lets boolean flags swallow the next token", () => {
    expect(parseArgs(["doctor", "--yes", "--json"]).flags).toEqual({ yes: true, json: true });
    expect(parseArgs(["get", "--url", "--make", "Porsche"]).flags).toEqual({ url: true, make: "Porsche" });
    expect(parseArgs(["billing", "--portal", "extra"]).positionals).toEqual(["extra"]);
  });

  it("treats a trailing value-less unknown flag as boolean and accepts negative numbers", () => {
    expect(parseArgs(["x", "--weird"]).flags.weird).toBe(true);
    expect(parseArgs(["x", "--offset", "-5"]).flags.offset).toBe("-5");
  });

  it("returns a null command for an empty argv", () => {
    expect(parseArgs([]).command).toBeNull();
    expect(parseArgs(["--json"]).command).toBeNull();
  });

  it("rejects unknown short options with a usage error", () => {
    expect(() => parseArgs(["-z"])).toThrowError(CliError);
    try {
      parseArgs(["-z"]);
    } catch (error) {
      expect((error as CliError).exitCode).toBe(2);
    }
  });
});

describe("flag helpers", () => {
  it("validates strings, integers and choices with exit code 2", () => {
    expect(flagString({ make: "Audi" }, "make")).toBe("Audi");
    expect(flagString({}, "make")).toBeUndefined();
    expect(() => flagString({ make: true }, "make")).toThrowError(/requires a value/);
    expect(() => requireString({}, "make")).toThrowError(/Missing required option --make/);
    expect(flagInteger({ width: "512" }, "width", { min: 1, max: 1024 })).toBe(512);
    expect(() => flagInteger({ width: "5000" }, "width", { min: 1, max: 1024 })).toThrowError(/at most 1024/);
    expect(() => flagInteger({ width: "abc" }, "width")).toThrowError(/must be a number/);
    expect(() => flagInteger({ width: "1.5" }, "width")).toThrowError(/integer/);
    expect(flagChoice({ view: "SIDE" }, "view", ["front", "side"] as const)).toBe("side");
    expect(() => flagChoice({ view: "top" }, "view", ["front", "side"] as const)).toThrowError(/Choose one of/);
    try {
      requireString({}, "year");
    } catch (error) {
      expect((error as CliError).exitCode).toBe(2);
    }
  });
});


it("accepts stdout as the value of --out", () => {
  expect(parseArgs(["logo", "--make", "Toyota", "--out", "-"])).toMatchObject({ command: "logo", positionals: [], flags: { make: "Toyota", out: "-" } });
});

describe("the --all flag", () => {
  it("is a boolean, so `help --all` cannot swallow a following word", () => {
    const parsed = parseArgs(["help", "--all", "request"]);
    expect(parsed.flags.all).toBe(true);
    expect(parsed.positionals).toEqual(["request"]);
  });
});
