import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OptionsResponse } from "@meterapp/car-image-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";
import { renderOptions } from "./catalog.js";

let dir: string;
let out: string[];
let err: string[];

/** A trimmed `GET /api/v1/images/options` payload in the shape the server sends. */
const OPTIONS: OptionsResponse["data"] = {
  views: [
    { id: "front", label: "Front", yaw_degrees: 0, elevation_degrees: 5, description: "Straight-on front view", aliases: [] },
    { id: "front-3-4", label: "Front three-quarter", yaw_degrees: 35, elevation_degrees: 5, description: "The classic hero angle", aliases: ["front34", "hero"] },
    { id: "top", label: "Top (from above)", yaw_degrees: 0, elevation_degrees: 90, description: "Straight down from above", aliases: ["top-down"] },
  ],
  colors: [
    { name: "white", hex: "#f4f4f2" },
    { name: "black", hex: "#141414" },
  ],
  sizes: { presets: { thumb: 256, small: 512, medium: 768, large: 1024 }, max: 1024, source: 1024 },
  fits: [
    { id: "contain", description: "Exactly w×h; the whole car visible, the rest transparent or the background color (default)." },
    { id: "cover", description: "Exactly w×h; scaled to fill the box and cropped at the centre." },
    { id: "inside", description: "The car fits within w×h; the output may be smaller than the box." },
  ],
  default_fit: "contain",
  backgrounds: { default: "transparent", jpg_default: "#ffffff", named: ["white", "black"], hex: "rrggbb, #rrggbb or rgb" },
  trim: { padding_max_percent: 50 },
  formats: [
    { id: "png", mime: "image/png", transparent: true },
    { id: "webp", mime: "image/webp", transparent: true },
    { id: "jpg", mime: "image/jpeg", transparent: false },
    { id: "auto", mime: "image/webp or image/png", transparent: true },
  ],
  pricing: {
    credits_per_image: 0,
    free_credits: 100,
    plans: [
      { code: "free", name: "Free", monthly_cents: 0, yearly_cents: 0, included_credits: 0, license: "evaluation", images_per_month: 30, image_period: "lifetime", courtesy_images: 30, vehicles_per_month: 100, rate_limit_per_minute: 120 },
      { code: "pro", name: "Pro", monthly_cents: 4900, yearly_cents: 49000, included_credits: 1000, license: "commercial", images_per_month: 2500, vehicles_per_month: 2500, rate_limit_per_minute: 120 },
      { code: "business", name: "Business", monthly_cents: 9900, yearly_cents: 99000, included_credits: 4000, license: "commercial", images_per_month: 10000, vehicles_per_month: 15000, rate_limit_per_minute: 600 },
      { code: "enterprise", name: "Enterprise", monthly_cents: null, yearly_cents: null, included_credits: 0, license: "commercial+export", images_per_month: null, vehicles_per_month: null, rate_limit_per_minute: 1200 },
    ],
  },
  catalog: {
    makes: 1593,
    models: 40167,
    years: { from: 1990, to: 2027 },
    sources: [
      { id: "nhtsa-vpic", name: "NHTSA Vehicle Product Information Catalog", region: "United States", license: "U.S. government public data" },
      { id: "rdw-nl-vehicle-register", name: "Netherlands RDW Vehicle Register", region: "Netherlands", license: "Public Domain" },
    ],
  },
  limits: { rate_limit_per_minute_default: 120, max_batch_urls: 50, delivery_ttl: { default: 3600, min: 60, max: 604800 } },
  links: { docs: "/docs", openapi: "/openapi.json" },
};

function env(): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", NO_COLOR: "1" };
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

interface Seen {
  url: string;
  auth: string | null;
}

function mockFetch(responses: Array<() => Response>) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
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
  dir = await mkdtemp(join(tmpdir(), "car-image-catalog-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderOptions", () => {
  const plain = { color: false };

  it("tables the formats by id, mime and background instead of stringifying the objects", () => {
    const text = renderOptions(plain, OPTIONS);
    expect(text).not.toContain("[object Object]");
    expect(text).toMatch(/Formats\nid\s+mime\s+background/);
    expect(text).toMatch(/png\s+image\/png\s+transparent/);
    expect(text).toMatch(/webp\s+image\/webp\s+transparent/);
    expect(text).toMatch(/jpg\s+image\/jpeg\s+opaque/);
    expect(text).toMatch(/auto\s+image\/webp or image\/png\s+transparent/);
  });

  it("explains the fit modes, the background vocabulary and the trim limits the server advertises", () => {
    const text = renderOptions(plain, OPTIONS);
    expect(text).toMatch(/Fit {2}--fit, with --width and --height \(default contain\)\nmode\s+result/);
    expect(text).toMatch(/contain\s+Exactly w×h; the whole car visible/);
    expect(text).toMatch(/cover\s+Exactly w×h; scaled to fill the box and cropped at the centre\./);
    expect(text).toMatch(/inside\s+The car fits within w×h; the output may be smaller than the box\./);
    expect(text).toMatch(/Backgrounds {2}--background\nvalue\s+accepted/);
    expect(text).toMatch(/default\s+transparent \(jpg: #ffffff\)/);
    expect(text).toMatch(/named\s+white, black/);
    expect(text).toMatch(/hex\s+rrggbb, #rrggbb or rgb/);
    expect(text).toContain("Trim  --trim crops to the car's own bounds before sizing");
    expect(text).toContain("--padding 0–50% of the car's longer side with --trim, of the stored frame without it");
    // Sizing options sit between the sizes and the formats, where a reader looks for them.
    expect(text.indexOf("Sizes")).toBeLessThan(text.indexOf("Fit  "));
    expect(text.indexOf("Trim  ")).toBeLessThan(text.indexOf("Formats"));
  });

  it("omits the delivery sections when an older server does not send them", () => {
    const legacy: OptionsResponse["data"] = { ...OPTIONS };
    delete legacy.fits;
    delete legacy.default_fit;
    delete legacy.backgrounds;
    delete legacy.trim;
    const text = renderOptions(plain, legacy);
    expect(text).not.toContain("Fit  ");
    expect(text).not.toContain("Backgrounds");
    expect(text).not.toContain("Trim  ");
    expect(text).not.toContain("undefined");
    expect(text).toMatch(/Sizes\npreset\s+size[\s\S]*\n\nFormats\nid\s+mime/);
  });

  it("spans the catalog years from `{from, to}` and names the sources by id", () => {
    const text = renderOptions(plain, OPTIONS);
    expect(text).toContain("Catalog  1,593 makes, 40,167 models, 1990–2027");
    expect(text).toContain("sources: nhtsa-vpic, rdw-nl-vehicle-register");
    expect(text).not.toContain("undefined");
  });

  it("drops the sources clause when the catalog reports none", () => {
    const text = renderOptions(plain, { ...OPTIONS, catalog: { ...OPTIONS.catalog, sources: [] } });
    expect(text).toContain("40,167 models, 1990–2027\n");
    expect(text).not.toContain("sources:");
  });

  it("still tables views, colors and sizes above the formats", () => {
    const text = renderOptions(plain, OPTIONS);
    expect(text).toMatch(/Views\nid\s+yaw\s+label/);
    expect(text).toMatch(/front-3-4\s+35°\s+Front three-quarter\s+The classic hero angle\s+aliases: front34, hero/);
    expect(text).toMatch(/top\s+overhead\s+Top \(from above\)/);
    expect(text).toMatch(/Colors\nname\s+hex/);
    expect(text).toMatch(/white\s+#f4f4f2/);
    expect(text).toMatch(/Sizes\npreset\s+size/);
    expect(text).toContain("max     1024 px (use --width/--height for exact sizes)");
    expect(text).toContain("Pricing  Free 30 vehicle images per account · Pro $49/mo 2,500 vehicle images · Business $99/mo 10,000 vehicle images · each image as often as you like · no overage");
  });

  it("prints the flat credit price when an older server lists no plans", () => {
    const { plans, ...pricing } = OPTIONS.pricing;
    expect(plans).toHaveLength(4);
    const text = renderOptions(plain, { ...OPTIONS, pricing: { ...pricing, credits_per_image: 1 } });
    expect(text).toContain("Pricing  1 credit per image · 100 free credits\n");
    expect(text).not.toContain("subscription");
  });
});

describe("car-image options", () => {
  it("reads the public endpoint without a key and prints every section", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: OPTIONS, request_id: "r1" })]);
    expect(await run(["options"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/images/options");
    expect(seen[0]?.auth).toBeNull();
    const text = out.join("");
    expect(text).not.toContain("[object Object]");
    expect(text).toMatch(/Formats\nid\s+mime\s+background/);
    expect(text).toContain("1990–2027");
    expect(err.join("")).toBe("");
  });

  it("passes the payload through untouched with --json", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: OPTIONS, request_id: "r2" })]);
    expect(await run(["options", "--json"], fetchImpl)).toBe(0);
    const parsed = JSON.parse(out.join("")) as OptionsResponse;
    expect(parsed.data.formats).toEqual(OPTIONS.formats);
    expect(parsed.data.catalog.years).toEqual({ from: 1990, to: 2027 });
  });
});
