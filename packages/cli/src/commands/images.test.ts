import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";
import { flagColor, flagMarket, flagView, imageParamsFromFlags, vehicleFromFlags } from "./images.js";

let dir: string;
let out: string[];
let err: string[];

const PNG = new Uint8Array([137, 80, 78, 71]);

function env(): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", CAR_IMAGE_API_KEY: "cimg_test", NO_COLOR: "1" };
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

function mockFetch(responses: Array<() => Response>) {
  const seen: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}

function run(argv: string[], fetchImpl?: typeof fetch) {
  return main(argv, { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-images-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("vehicle and color flags", () => {
  it("takes a vehicle id or the three vehicle options, never both", () => {
    expect(vehicleFromFlags({ vehicle: " veh_395yw8tn73ff8 " })).toEqual({ vehicle: "veh_395yw8tn73ff8" });
    expect(vehicleFromFlags({ make: "Porsche", model: "911", year: "2024" })).toEqual({ make: "Porsche", model: "911", year: "2024" });
    expect(() => vehicleFromFlags({ vehicle: "veh_395yw8tn73ff8", year: "2024" })).toThrow(/not both/);
    expect(() => vehicleFromFlags({ make: "Porsche" })).toThrow(/--model/);
  });

  it("accepts presets in any case, CSS color names and hex paint in either spelling", () => {
    expect(flagColor({ color: "Red" })).toBe("red");
    expect(flagColor({ color: "grey" })).toBe("grey");
    expect(flagColor({ color: "Navy" })).toBe("navy");
    expect(flagColor({ color: "#1A2B3C" })).toBe("#1A2B3C");
    expect(flagColor({ color: "1a2b3c" })).toBe("1a2b3c");
    expect(flagColor({ color: "#abc" })).toBe("#abc");
    expect(flagColor({})).toBeUndefined();
    expect(() => flagColor({ color: "navyish" })).toThrow(/hex paint such as #1a2b3c/);
    expect(() => flagColor({ color: "#12345" })).toThrow(/Invalid --color/);
  });

  it("reads a view alias as the angle it names", () => {
    expect(flagView({ view: "left" })).toBe("side");
    expect(flagView({ view: "Front-Right" })).toBe("front-3-4-right");
    expect(flagView({ view: "rear-3-4" })).toBe("rear-3-4");
    expect(flagView({})).toBeUndefined();
    expect(flagView({ view: "Top Down" })).toBe("top");
    expect(() => flagView({ view: "bottom" })).toThrow(/Invalid --view "bottom"/);
  });

  it("leaves a size above 1024 to the server, which clamps it", () => {
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", width: "1920", height: "1080" })).toMatchObject({ width: 1920, height: 1080 });
    expect(() => imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", width: "0" })).toThrow(/at least 1/);
  });

  it("takes --market as a two-letter country code in any case, and sends none without it", () => {
    expect(flagMarket({ market: "au" })).toBe("AU");
    expect(flagMarket({ market: " Gb " })).toBe("GB");
    expect(flagMarket({})).toBeUndefined();
    expect(() => flagMarket({ market: "australia" })).toThrow(/Invalid --market "australia"/);
    expect(() => flagMarket({ market: true })).toThrow();
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", market: "au" })).toMatchObject({ market: "AU" });
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8" })).not.toHaveProperty("market");
  });

  it("asks for a ground shadow with --shadow, and for none without it", () => {
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", shadow: true })).toMatchObject({ shadow: true });
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8" })).not.toHaveProperty("shadow");
  });

  it("takes a framing preset in any case, and refuses it beside --trim or --padding", () => {
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", framing: "Tight" })).toMatchObject({ framing: "tight" });
    expect(imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8" })).not.toHaveProperty("framing");
    expect(() => imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", framing: "snug" })).toThrow(/consistent, tight, balanced/);
    expect(() => imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", framing: "balanced", trim: true })).toThrow(/--framing replaces --trim/);
    expect(() => imageParamsFromFlags({ vehicle: "veh_395yw8tn73ff8", framing: "consistent", trim: true, padding: "4" })).toThrow(/--framing replaces/);
  });
});

describe("car-image get and url with vehicle ids and hex paint", () => {
  it("renders by vehicle id with a hex paint spelled bare in the query", async () => {
    const { fetchImpl, seen } = mockFetch([() => new Response(PNG, { headers: { "Content-Type": "image/png", "X-Credits-Charged": "1", "X-Credits-Remaining": "98", "X-Request-Id": "req_1" } })]);
    const file = join(dir, "paint.png");
    expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--color", "#1A2B3C", "--view", "side", "--out", file], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/images/car?vehicle=veh_395yw8tn73ff8&view=side&color=1a2b3c");
    expect(new Uint8Array(await readFile(file))).toEqual(PNG);
    expect(out.join("")).toContain(`Saved ${file}`);
  });

  it("names the vehicle served in --json, from X-Vehicle-Id, as --url does from the JSON", async () => {
    const { fetchImpl } = mockFetch([() => new Response(PNG, { headers: { "Content-Type": "image/png", "X-Credits-Charged": "1", "X-Vehicle-Id": "veh_395yw8tn73ff8", "X-Request-Id": "req_1" } })]);
    expect(await run(["get", "--make", "Porsche", "--model", "911", "--year", "2024", "--out", join(dir, "911.png"), "--json"], fetchImpl)).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ vehicle_id: "veh_395yw8tn73ff8", credits_charged: 1, request_id: "req_1" });
  });

  it("names the default file after the vehicle id and the paint", async () => {
    const { fetchImpl } = mockFetch([() => new Response(PNG, { headers: { "Content-Type": "image/png" } })]);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--color", "1a2b3c"], fetchImpl)).toBe(0);
      expect(new Uint8Array(await readFile(join(dir, "veh_395yw8tn73ff8-front-3-4-1a2b3c.png")))).toEqual(PNG);
    } finally {
      process.chdir(cwd);
    }
  });

  it("sends a vehicle id or a hex color in the JSON body of url, single and batched", async () => {
    const created = () => Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 97 }, request_id: "r" }, { status: 201 });
    const { fetchImpl, seen } = mockFetch([created, created]);
    expect(await run(["url", "--vehicle", "veh_395yw8tn73ff8", "--color", "#1a2b3c", "--json"], fetchImpl)).toBe(0);
    expect(seen[0]?.body).toEqual({ images: [{ vehicle: "veh_395yw8tn73ff8", color: "#1a2b3c" }] });
    const batch = join(dir, "batch.json");
    await writeFile(batch, JSON.stringify([{ vehicle: "veh_395yw8tn73ff8", color: "1a2b3c" }, { make: "Porsche", model: "911", year: 2024, color: "red" }]));
    expect(await run(["url", "--batch", batch, "--json"], fetchImpl)).toBe(0);
    expect(seen[1]?.body).toEqual({ images: [{ vehicle: "veh_395yw8tn73ff8", color: "1a2b3c" }, { make: "Porsche", model: "911", year: 2024, color: "red" }] });
  });

  it("tags get, get --url and url with --campaign and --pieces, and each batch entry with its own", async () => {
    const image = () => new Response(PNG, { headers: { "Content-Type": "image/png", "X-Campaign": encodeURIComponent("Spring mailer"), "X-Pieces": "25000" } });
    const signed = () => Response.json({ data: { url: "https://u", expires_at: "x", vehicle: {}, width: null, height: null, format: "png" }, billing: { credits_charged: 0 }, request_id: "r" });
    const created = () => Response.json({ data: [{ url: "https://u/1", expires_at: "x", max_uses: 0 }], billing: { charged_on: "creation", credits_charged: 0 }, campaign: "Owners mailer", pieces: 8300, request_id: "r" }, { status: 201 });
    const { fetchImpl, seen } = mockFetch([image, signed, created, created]);
    expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--campaign", "Spring mailer", "--pieces", "25000", "--out", join(dir, "a.png"), "--json"], fetchImpl)).toBe(0);
    const query = new URL(seen[0]!.url).searchParams;
    expect(query.get("campaign")).toBe("Spring mailer");
    expect(query.get("pieces")).toBe("25000");
    expect(JSON.parse(out.join(""))).toMatchObject({ campaign: "Spring mailer", pieces: 25000 });
    expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--url", "--pieces", "12"], fetchImpl)).toBe(0);
    expect(new URL(seen[1]!.url).searchParams.get("pieces")).toBe("12");
    expect(await run(["url", "--vehicle", "veh_395yw8tn73ff8", "--campaign", "Owners mailer", "--pieces", "8300"], fetchImpl)).toBe(0);
    expect(seen[2]?.body).toEqual({ images: [{ vehicle: "veh_395yw8tn73ff8" }], campaign: "Owners mailer", pieces: 8300 });
    expect(err.join("")).toContain('campaign "Owners mailer", 8,300 pieces');
    const batch = join(dir, "batch.json");
    await writeFile(batch, JSON.stringify([{ vehicle: "veh_395yw8tn73ff8", pieces: 3200 }, { make: "Ford", model: "F-150", year: 2024, pieces: 5100, campaign: "Ford owners" }]));
    expect(await run(["url", "--batch", batch, "--campaign", "Owners mailer", "--json"], fetchImpl)).toBe(0);
    expect(seen[3]?.body).toEqual({
      images: [{ vehicle: "veh_395yw8tn73ff8", pieces: 3200 }, { make: "Ford", model: "F-150", year: 2024, pieces: 5100, campaign: "Ford owners" }],
      campaign: "Owners mailer",
    });
  });

  it("refuses malformed campaign labels before any request", async () => {
    for (const args of [["--pieces", "0"], ["--pieces", "2,500"], ["--pieces", "2.5e3"], ["--pieces", "10000001"], ["--campaign", "x".repeat(101)]]) {
      err = [];
      expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", ...args]), args.join(" ")).toBe(2);
      expect(err.join("")).toMatch(/--(pieces|campaign)/);
    }
    err = [];
    expect(await run(["logo", "--make", "BMW", "--campaign", "x"])).toBe(2);
    expect(err.join("")).toContain("--campaign is not supported for make logos");
    const batch = join(dir, "bad.json");
    await writeFile(batch, JSON.stringify([{ vehicle: "veh_395yw8tn73ff8", pieces: 0 }]));
    err = [];
    expect(await run(["url", "--batch", batch])).toBe(2);
    expect(err.join("")).toContain("Batch entry 0");
  });

  it("shows campaign tracking with whoami campaigns", async () => {
    const usage = () =>
      Response.json({
        data: {
          from: "2026-11-01T00:00:00.000Z",
          to: "2026-11-28T00:00:00.000Z",
          totals: { requests: 2, pieces: 8300, loads: 40, campaigns: 1 },
          by_campaign: [{ campaign: "Owners mailer", requests: 2, pieces: 8300, loads: 40 }, { campaign: null, requests: 1, pieces: 5, loads: 0 }],
          by_vehicle: [{ vehicle_id: "veh_395yw8tn73ff8", make: "toyota", model: "camry", year: 2024, requests: 1, pieces: 3200, campaigns: ["Owners mailer"] }],
          truncated: false,
        },
        request_id: "r",
      });
    const { fetchImpl, seen } = mockFetch([usage, usage]);
    expect(await run(["whoami", "campaigns", "--from", "2026-11-01", "--to", "2026-11-28"], fetchImpl)).toBe(0);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/v1/account/campaigns");
    expect(url.searchParams.get("from")).toBe("2026-11-01");
    const text = out.join("");
    expect(text).toContain("8,300 pieces over 2 tagged requests");
    expect(text).toContain("Owners mailer");
    expect(text).toContain("(no campaign)");
    expect(text).toContain("2024 toyota camry");
    out = [];
    expect(await run(["account", "campaigns", "--json"], fetchImpl)).toBe(0);
    expect(JSON.parse(out.join("")).data.totals.pieces).toBe(8300);
    expect(await run(["whoami", "bogus"])).toBe(2);
  });

  it("rejects both selectors, a missing selector and a made-up color before any request", async () => {
    expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--make", "Porsche"])).toBe(2);
    expect(err.join("")).toContain("not both");
    err = [];
    expect(await run(["get", "--color", "red"])).toBe(2);
    expect(err.join("")).toContain("--vehicle veh_395yw8tn73ff8");
    err = [];
    expect(await run(["get", "--make", "Porsche", "--model", "911", "--year", "2024", "--color", "navyish"])).toBe(2);
    expect(err.join("")).toContain('Invalid --color "navyish"');
    err = [];
    expect(await run(["feedback", "--good"])).toBe(2);
    expect(err.join("")).toContain("report-image");
  });

  it("refuses --max-uses above 1000, the most POST /api/v1/image-urls accepts, before any request", async () => {
    const created = () => Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 97 }, request_id: "r" }, { status: 201 });
    const { fetchImpl, seen } = mockFetch([created]);
    expect(await run(["url", "--vehicle", "veh_395yw8tn73ff8", "--max-uses", "1001"], fetchImpl)).toBe(2);
    expect(err.join("")).toContain("--max-uses");
    expect(seen).toHaveLength(0);
    expect(await run(["url", "--vehicle", "veh_395yw8tn73ff8", "--max-uses", "1000", "--json"], fetchImpl)).toBe(0);
    expect(seen[0]?.body).toMatchObject({ max_uses: 1000 });
  });

});


describe("car-image logo", () => {
  it("downloads with all transform flags and returns billing metadata without a fake vehicle", async () => {
    const { fetchImpl, seen } = mockFetch([() => new Response(PNG, { headers: {
      "Content-Type": "image/png", "X-Credits-Charged": "1", "X-Credits-Remaining": "99", "X-Request-Id": "logo_1",
    } })]);
    const file = join(dir, "logo.png");
    expect(await run(["logo", "--make", "Toyota", "--width", "256", "--height", "128", "--fit", "inside", "--background", "#fff", "--trim", "--padding", "0", "--format", "auto", "--out", file, "--json"], fetchImpl)).toBe(0);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/v1/images/logo");
    expect(Object.fromEntries(url.searchParams)).toEqual({ make: "Toyota", w: "256", h: "128", fit: "inside", background: "#fff", trim: "1", padding: "0", format: "auto" });
    expect(new Uint8Array(await readFile(file))).toEqual(PNG);
    const result = JSON.parse(out.join(""));
    expect(result).toMatchObject({ credits_charged: 1, credits_remaining: 99, request_id: "logo_1" });
    expect(result).not.toHaveProperty("vehicle_id");
    expect(result.notice).toContain("no license is granted");
    expect(out.join("")).not.toContain("feedback");
  });

  it("names auto output for the actual response format", async () => {
    const { fetchImpl } = mockFetch([() => new Response(PNG, { headers: { "Content-Type": "image/webp" } })]);
    const cwd = process.cwd(); process.chdir(dir);
    try {
      expect(await run(["logo", "--make", "Toyota", "--format", "auto"], fetchImpl)).toBe(0);
      expect(new Uint8Array(await readFile(join(dir, "toyota-logo.webp")))).toEqual(PNG);
      expect(out.join("")).not.toContain("feedback");
      expect(err.join("")).toContain("third-party trademarks");
    } finally { process.chdir(cwd); }
  });

  it("rejects unsupported vehicle and signed URL flags before spending credits", async () => {
    const { fetchImpl, seen } = mockFetch([]);
    for (const extra of [["--url"], ["--color", "red"], ["--model", "Camry"], ["--padding", "3"], ["--shadow"], ["--framing", "tight"]]) {
      expect(await run(["logo", "--make", "Toyota", ...extra], fetchImpl)).toBe(2);
    }
    expect(await run(["logo"], fetchImpl)).toBe(2);
    expect(seen).toHaveLength(0);
  });
});
