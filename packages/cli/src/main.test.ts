import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./main.js";
import { CLI_VERSION } from "./version.js";

let dir: string;
let out: string[];
let err: string[];

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", NO_COLOR: "1", ...extra };
}

function io() {
  return {
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
    isTTY: false,
    stdinTTY: false,
    color: false,
  };
}

function run(argv: string[], options: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}) {
  return main(argv, { env: env(options.env), io: io(), fetch: options.fetch, skipUpdateCheck: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-main-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("main", () => {
  it("prints the version and help", async () => {
    expect(await run(["--version"])).toBe(0);
    expect(out.join("")).toBe(`${CLI_VERSION}\n`);
    out = [];
    expect(await run(["--help"])).toBe(0);
    // The first screen teaches six commands; the rest are one flag away.
    const first = out.join("");
    expect(first).toContain("Commands:");
    for (const name of ["login", "get", "url", "search", "vin", "doctor"]) expect(first).toMatch(new RegExp(`^  ${name}\\s{2,}`, "m"));
    expect(first).toContain("More: car-image help --all");
    // Free is 30 vehicle images per account in total (carimage.dev/pricing); the help once said "100 a month".
    expect(first).toContain("Free has 30 per account, in total.");
    expect(first).not.toContain("a month.");
    expect(first).not.toMatch(/^ {2}agent-config\s{2,}/m);
    expect(first).not.toMatch(/^ {2}request \(requests\)/m);
    out = [];
    expect(await run(["help", "--all"])).toBe(0);
    expect(out.join("")).toMatch(/^ {2}agent-config\s{2,}/m);
    expect(out.join("")).toContain("request (requests)");
    expect(out.join("")).not.toContain("More: car-image help --all");
    out = [];
    expect(await run(["--help", "--all"])).toBe(0);
    expect(out.join("")).toMatch(/^ {2}agent-config\s{2,}/m);
    out = [];
    expect(await run([])).toBe(0);
    expect(out.join("")).toContain("Usage:");
    expect(out.join("")).toContain("More: car-image help --all");
    out = [];
    expect(await run(["get", "--help"])).toBe(0);
    expect(out.join("")).toContain("car-image get");
    // An aliased command shows its own usage, not the general help.
    out = [];
    expect(await run(["3d", "--help"])).toBe(0);
    expect(out.join("")).toContain("car-image 3d create");
    expect(out.join("")).not.toContain("Commands:");
    // A command off the first screen still has its own help.
    out = [];
    expect(await run(["logo", "--help"])).toBe(0);
    expect(out.join("")).toContain("car-image logo");
    expect(out.join("")).not.toContain("Commands:");
    out = [];
    expect(await run(["help", "request"])).toBe(0);
    expect(out.join("")).toContain("car-image request list");
  });

  it("returns 2 for unknown commands and usage errors", async () => {
    expect(await run(["frobnicate"])).toBe(2);
    expect(err.join("")).toContain('Unknown command "frobnicate"');
    err = [];
    expect(await run(["get", "--make", "Porsche"])).toBe(2);
    expect(err.join("")).toContain("Missing required option --model");
  });

  it("asks the user to log in when a keyed command has no key", async () => {
    expect(await run(["whoami"])).toBe(1);
    expect(err.join("")).toContain("Not signed in");
    expect(err.join("")).toContain("car-image login");
  });

  it("renders problem+json errors with hints and request ids", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ title: "Insufficient credits", detail: "This request needs 1 credit; balance is 0", status: 402, request_id: "req_42" }), {
        status: 402,
        headers: { "Content-Type": "application/problem+json" },
      });
    expect(await run(["get", "--make", "Porsche", "--model", "911", "--year", "2024", "--api-key", "cimg_test"], { fetch: fetchImpl })).toBe(1);
    const text = err.join("");
    expect(text).toContain("Insufficient credits: This request needs 1 credit; balance is 0");
    expect(text).toContain("car-image upgrade --plan");
    expect(text).toContain("request id: req_42");
  });

  it("emits JSON errors on stdout with --json", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ title: "Invalid API key", detail: "revoked", status: 401 }), { status: 401, headers: { "Content-Type": "application/problem+json" } });
    expect(await run(["whoami", "--json", "--api-key", "cimg_test"], { fetch: fetchImpl })).toBe(1);
    const parsed = JSON.parse(out.join("")) as { error: { message: string; hint: string; status: number } };
    expect(parsed.error.status).toBe(401);
    expect(parsed.error.hint).toContain("car-image login");
  });

  it("runs a public command through the SDK and prints a table", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json({ data: { results: [{ kind: "model", makeName: "Porsche", modelName: "911", years: [1990, 2024], matchKind: "exact", vehicleType: "Passenger Car" }] } });
    };
    expect(await run(["search", "porsche", "911"], { fetch: fetchImpl })).toBe(0);
    expect(seen[0]).toBe("https://api.test/api/v1/vehicles?q=porsche+911");
    const text = out.join("");
    expect(text).toContain("Porsche");
    expect(text).toContain("1990–2024");
    expect(text).toContain("car-image get --make Porsche --model 911 --year 2024");
  });

  it("prints agent configuration without any network access", async () => {
    expect(await run(["agent-config", "--host", "claude-code"])).toBe(0);
    expect(out.join("")).toContain("claude mcp add --transport http car-image https://api.test/api/mcp");
    out = [];
    expect(await run(["agent-config", "--json", "--remote"])).toBe(0);
    const parsed = JSON.parse(out.join("")) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
    expect(parsed.mcpServers["car-image"]?.url).toBe("https://api.test/api/mcp");
    // Claude Code's JSON carries no Authorization header: one would turn its browser sign-in off.
    out = [];
    expect(await run(["agent-config", "--host", "claude-code", "--json", "--remote"])).toBe(0);
    const claudeCode = JSON.parse(out.join("")) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
    expect(claudeCode.mcpServers["car-image"]).toEqual({ type: "http", url: "https://api.test/api/mcp" });
  });

  it("manages config and telemetry settings", async () => {
    expect(await run(["config", "set", "autoUpdate", "never"])).toBe(0);
    out = [];
    expect(await run(["config", "get", "autoUpdate"])).toBe(0);
    expect(out.join("")).toBe("never\n");
    expect(await run(["config", "set", "autoUpdate", "sometimes"])).toBe(2);
    out = [];
    expect(await run(["telemetry", "status", "--json"])).toBe(0);
    expect(JSON.parse(out.join("")) as { enabled: boolean }).toMatchObject({ enabled: false });
    out = [];
    expect(await run(["config", "path"])).toBe(0);
    expect(out.join("")).toBe(`${join(dir, "config.json")}\n`);
  });

  it("asks the registry in the background worker, silently, and reports it with update --check", async () => {
    const registry = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: "@meterapp/car-image", version: "99.0.0" }));
    });
    await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
    const registryEnv = { CAR_IMAGE_NPM_REGISTRY: `http://127.0.0.1:${(registry.address() as AddressInfo).port}` };
    try {
      // The worker other commands start: no output, no telemetry, and from a source checkout no install either.
      expect(await main(["update", "--worker"], { env: env(registryEnv), io: io() })).toBe(0);
      expect(out.join("") + err.join("")).toBe("");
      expect(JSON.parse(await readFile(join(dir, "update-check.json"), "utf8"))).toMatchObject({ latest: "99.0.0" });
      expect(await run(["update", "--check", "--json"], { env: registryEnv })).toBe(0);
      expect(JSON.parse(out.join(""))).toMatchObject({ current: CLI_VERSION, latest: "99.0.0", update_available: true, registry_reached: true, auto_update: "always", install: { method: "source" } });
      out = [];
      expect(await run(["config", "get", "autoUpdate"])).toBe(0);
      expect(out.join("")).toBe("always\n");
    } finally {
      registry.close();
    }
  });

  it("clears baseUrl when it is set to the default or the legacy alias", async () => {
    expect(await run(["config", "set", "baseUrl", "http://localhost:3000/"])).toBe(0);
    out = [];
    expect(await run(["config", "get", "baseUrl"])).toBe(0);
    expect(out.join("")).toBe("http://localhost:3000\n");
    for (const value of ["https://car-imgs.vercel.app", "https://carimage.dev"]) {
      out = [];
      expect(await run(["config", "set", "baseUrl", value])).toBe(0);
      expect(out.join("")).toContain("baseUrl = (default) https://carimage.dev");
      out = [];
      expect(await run(["config", "get", "baseUrl"])).toBe(0);
      expect(out.join("")).toBe("\n");
    }
    out = [];
    expect(await run(["config", "set", "baseUrl", "https://car-imgs.vercel.app", "--json"])).toBe(0);
    expect(JSON.parse(out.join(""))).toEqual({ ok: true, baseUrl: null, default: "https://carimage.dev" });
  });

  it("sends an old login's saved car-imgs.vercel.app base URL to carimage.dev", async () => {
    await writeFile(join(dir, "config.json"), JSON.stringify({ apiKey: "cimg_old", baseUrl: "https://car-imgs.vercel.app" }));
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return Response.json({ data: { credits: 500, auto_reload: false, has_payment_method: false }, request_id: "r1" });
    }) as typeof fetch;
    expect(await run(["whoami", "--json"], { env: { CAR_IMAGE_API_URL: undefined }, fetch: fetchImpl })).toBe(0);
    expect(urls).toEqual(["https://carimage.dev/api/v1/account"]);
    expect((JSON.parse(out.join("")) as { base_url: string }).base_url).toBe("https://carimage.dev");
    out = [];
    expect(await run(["config", "list", "--json"], { env: { CAR_IMAGE_API_URL: undefined } })).toBe(0);
    expect((JSON.parse(out.join("")) as { baseUrl: string }).baseUrl).toBe("(default)");
    expect(JSON.parse(await readFile(join(dir, "config.json"), "utf8"))).toMatchObject({ apiKey: "cimg_old" });
  });

  it("says which plan the account is on, what its license allows and this month's vehicle images", async () => {
    const plan = { code: "pro", name: "Pro", status: "active", active: true, provider: "stripe", interval: "month", included_credits: 1000, license: "commercial", meter: "vehicle_images", limits: { images_per_month: 2500, rate_limit_per_minute: 120 } };
    const limits_usage = {
      period: { month_start: "2026-10-01T00:00:00.000Z", resets_at: "2026-11-01T00:00:00.000Z" }, meter: "vehicle_images",
      vehicle_images_this_month: { used: 2500, limit: 2500, remaining: 0 },
      distinct_vehicles_this_month: null, api_keys: { used: 1, limit: 10, remaining: 9 }, requests_per_minute_per_key: 120, requests_per_minute_per_account: 600,
    };
    const fetchImpl = (async () =>
      Response.json({ data: { credits: 3, auto_reload: false, has_payment_method: true, plan, limits_usage }, request_id: "r1" })) as unknown as typeof fetch;
    expect(await run(["whoami", "--api-key", "cimg_test"], { fetch: fetchImpl })).toBe(0);
    const text = out.join("");
    expect(text).toContain("Pro  (commercial license while subscribed; delete stored copies within 30 days after it ends)");
    expect(text).toContain("2,500 of 2,500 vehicle images this month");
    expect(text).not.toMatch(/new (vehicle )?views?/i);
    expect(text).toContain("The vehicle-image allowance is used up for this month");
    expect(text).not.toContain("Low balance");
    expect(text).not.toContain("(inactive)");
  });

  it("points a low balance on the credit meter at a plan, never at buying credits", async () => {
    const fetchImpl = (async () =>
      Response.json({ data: { credits: 3, auto_reload: false, has_payment_method: false }, request_id: "r1" })) as unknown as typeof fetch;
    expect(await run(["whoami", "--api-key", "cimg_test"], { fetch: fetchImpl })).toBe(0);
    const text = out.join("");
    expect(text).toContain("Low balance. Credits are no longer sold; a plan includes vehicle images and credits every month: car-image upgrade --plan pro (https://api.test/dashboard?ref=cli#plan)");
    expect(text).not.toContain("--credits");
  });
});
