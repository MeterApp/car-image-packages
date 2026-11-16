import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLI_VERSION, PACKAGE_NAME } from "./version.js";

describe("CLI_VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string; name: string; bin: Record<string, string> };
    expect(CLI_VERSION).toBe(pkg.version);
    expect(PACKAGE_NAME).toBe(pkg.name);
    expect(pkg.bin["car-image"]).toBe("./dist/bin.js");
  });
});
