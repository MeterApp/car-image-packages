import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";

let dir: string;
let out: string[];
let err: string[];

const PACK = "pck_0123456789abcdef0123456789abcdef";
const OFFER = { id: "pack-500-enhanced", images: 500, quality: "enhanced", multiplier: 2, price_cents: 29_900, price: 299, per_image: 0.598, checkout_url: "https://checkout.example/pack-500-enhanced" };
const WAIT = "We create a paint mask for each car so it can be shown in any color you request. Standard quality is the default because it is quick. Enhanced and Premium take another, longer pass. We'll send a webhook when each car is ready.";

function env(): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", NO_COLOR: "1", CAR_IMAGE_API_KEY: "cimg_test" };
}
const io = () => ({ stdout: (text: string) => void out.push(text), stderr: (text: string) => void err.push(text), isTTY: false, stdinTTY: false, color: false });

function mockFetch(responses: Array<() => Response>) {
  const seen: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}
const run = (argv: string[], fetchImpl: typeof fetch) => main(argv, { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-packs-"));
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("car-image packs", () => {
  it("prints the Checkout link of the pack asked for, for a human to pay", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: [], offers: [OFFER], request_id: "r" })]);
    expect(await run(["packs", "buy", "--images", "500", "--quality", "enhanced"], fetchImpl)).toBe(0);
    expect(out.join("")).toContain("$299 one-time");
    expect(out.join("")).toContain(OFFER.checkout_url);
  });

  it("sends a batch from a vehicle CSV with the views asked for and an Idempotency-Key", async () => {
    const file = join(dir, "cars.csv");
    await writeFile(file, "make,model,year,ref\ntoyota,camry,2024,A1\nhonda,civic,2023,A2\n");
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({
        data: { id: "pbt_1", object: "pack_batch", status: "queued", quality: "enhanced", items: 4, images_charged: 4, pack: { images_remaining: 496 } },
        eta: { typical_seconds: 240, per_image_seconds: 76, images_stored: 0, images_to_draw: 4 }, why_it_takes_time: WAIT, why_it_takes_time_url: "https://api.test/docs/packs#timing", request_id: "r",
      }, { status: 202 }),
    ]);
    expect(await run(["packs", "batch", PACK, file, "--views", "front-3-4,rear-3-4", "--quality", "high"], fetchImpl)).toBe(0);
    expect(seen[0].url).toBe(`https://api.test/api/v1/packs/${PACK}/batches`);
    expect(seen[0].headers.get("idempotency-key")).toBeTruthy();
    expect(seen[0].body).toEqual({
      quality: "enhanced",
      items: [
        { make: "toyota", model: "camry", year: 2024, views: ["front-3-4", "rear-3-4"], ref: "A1" },
        { make: "honda", model: "civic", year: 2023, views: ["front-3-4", "rear-3-4"], ref: "A2" },
      ],
    });
    expect(out.join("")).toContain("4 taken from the pack (496 left)");
    expect(out.join("")).toContain(WAIT);
  });

  it("says plainly when pack sales are paused", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: [], offers: [], request_id: "r" })]);
    expect(await run(["packs", "buy", "--images", "500"], fetchImpl)).not.toBe(0);
    expect(err.join("")).toMatch(/sales are paused/);
  });
});
