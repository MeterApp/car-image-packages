import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VinResult } from "@meterapp/car-image-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixHintFor } from "../errors.js";
import { main } from "../main.js";
import { engineLabel, renderVin, transmissionLabel, vinFixHint } from "./vin.js";

let dir: string;
let out: string[];
let err: string[];

const DECODED: VinResult = {
  vin: "1HGCM82633A004352",
  valid: true,
  errors: [],
  suggested_vin: null,
  year: 2003,
  make: "Honda",
  model: "Accord",
  trim: "EX-V6",
  series: null,
  body_class: "Sedan/Saloon",
  vehicle_type: "Passenger Car",
  doors: 4,
  drive_type: null,
  fuel_type: "Gasoline",
  engine: { cylinders: 6, displacement_l: 3, hp: null, model: "J30A4" },
  transmission: { style: "Automatic", speeds: 5 },
  manufacturer: "American Honda Motor Co., Inc.",
  plant: { city: "Marysville", state: "Ohio", country: "United States (USA)" },
  gvwr: "Class 1C: 4,001 - 5,000 lb (1,814 - 2,268 kg)",
  attributes: { Make: "HONDA", Model: "Accord", "Model Year": "2003" },
  vehicle: { id: "veh_395yw8tn73ff8", make: "Honda", model: "Accord", year: 2003, image_path: "/api/v1/images/car?vehicle=veh_395yw8tn73ff8" },
  source: "vpic-db",
};

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", CAR_IMAGE_API_KEY: "cimg_test", NO_COLOR: "1", ...extra };
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
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}

function run(argv: string[], fetchImpl?: typeof fetch, extraEnv: Record<string, string> = {}) {
  return main(argv, { env: env(extraEnv), io: io(), fetch: fetchImpl, skipUpdateCheck: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-vin-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderVin", () => {
  it("lists the headline fields, the catalog vehicle and a ready command", () => {
    const text = renderVin({ color: false }, DECODED);
    expect(text).toMatch(/vin\s+1HGCM82633A004352/);
    expect(text).toMatch(/make\s+Honda/);
    expect(text).toMatch(/engine\s+6-cyl 3 L J30A4/);
    expect(text).toMatch(/transmission\s+Automatic, 5 speeds/);
    expect(text).toMatch(/plant\s+Marysville, Ohio, United States \(USA\)/);
    expect(text).toContain("Catalog vehicle  2003 Honda Accord · veh_395yw8tn73ff8");
    expect(text).toContain("car-image get --vehicle veh_395yw8tn73ff8");
    expect(text).not.toContain("Decoder notes");
    expect(text).not.toContain("undefined");
  });

  it("shows decoder notes and says when the catalog lacks the car", () => {
    const text = renderVin(
      { color: false },
      { ...DECODED, valid: false, errors: [{ code: 1, text: "Check Digit (9th position) does not calculate properly" }], suggested_vin: "1HGCM82633A004353", vehicle: null }
    );
    expect(text).toMatch(/valid\s+no/);
    expect(text).toContain("Decoder notes");
    expect(text).toContain("Check Digit");
    expect(text).toContain("Suggested VIN: 1HGCM82633A004353");
    expect(text).toContain("Not in the image catalog");
    expect(engineLabel({ cylinders: null, displacement_l: null, hp: null, model: null })).toBe("—");
    expect(transmissionLabel({ style: null, speeds: null })).toBe("—");
  });
});

describe("car-image vin", () => {
  it("decodes through the API with the year hint and prints the summary", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: DECODED, request_id: "req_vin" })]);
    expect(await run(["vin", "1HGCM82633A004352", "--year", "2003"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/vin/1HGCM82633A004352?year=2003");
    expect(seen[0]?.auth).toBe("Bearer cimg_test");
    expect(out.join("")).toContain("Honda");
    expect(out.join("")).toContain("car-image get --vehicle veh_395yw8tn73ff8");
  });

  it("passes the payload through with --json and keeps a partial VIN's stars", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: { ...DECODED, vin: "1HGCM826*3A" }, request_id: "req_vin" })]);
    expect(await run(["vin", "1HGCM826*3A", "--json"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/vin/1HGCM826*3A");
    expect((JSON.parse(out.join("")) as { data: { vin: string } }).data.vin).toBe("1HGCM826*3A");
  });

  it("needs a VIN and a key", async () => {
    expect(await run(["vin"])).toBe(2);
    expect(err.join("")).toContain("Missing VIN");
    err = [];
    expect(await run(["vin", "1HGCM82633A004352"], undefined, { CAR_IMAGE_API_KEY: "" })).toBe(1);
    expect(err.join("")).toContain("Not signed in");
  });
});

/** A problem+json answer as the REST API sends it. */
function problem(status: number, title: string, detail: string, requestId: string): () => Response {
  return () =>
    new Response(JSON.stringify({ type: `https://carimage.dev/docs/errors#${status}`, title, status, detail, request_id: requestId }), {
      status,
      headers: { "Content-Type": "application/problem+json", "X-Request-Id": requestId },
    });
}

const NOT_RECOGNIZED = problem(404, "VIN not recognized", "NHTSA has no record of this VIN pattern. Check the characters, or send the full 17-character VIN.", "req_vin404");

describe("car-image vin errors", () => {
  it("says how to fix a VIN NHTSA cannot place, not how to search the catalog", async () => {
    const { fetchImpl } = mockFetch([NOT_RECOGNIZED]);
    expect(await run(["vin", "00000000000000000"], fetchImpl)).toBe(1);
    const text = err.join("");
    expect(text).toContain("✗ VIN not recognized: NHTSA has no record of this VIN pattern.");
    expect(text).toContain(`→ ${vinFixHint(404)}`);
    expect(text).toContain("first three characters (the maker code)");
    expect(text).toContain(`\`car-image vin "1HGCM826*3A" --year 2003\``);
    expect(text).not.toContain("Vehicle not in the catalog?");
    expect(text).toContain("request id: req_vin404");
  });

  it("puts the same hint in --json output", async () => {
    const { fetchImpl } = mockFetch([NOT_RECOGNIZED]);
    expect(await run(["vin", "00000000000000000", "--json"], fetchImpl)).toBe(1);
    const parsed = JSON.parse(out.join("")) as { error: { message: string; hint: string | null; request_id: string; status: number } };
    expect(parsed.error).toEqual({
      message: "VIN not recognized: NHTSA has no record of this VIN pattern. Check the characters, or send the full 17-character VIN.",
      hint: vinFixHint(404),
      request_id: "req_vin404",
      status: 404,
    });
  });

  it("prints a refused VIN once, with no catalog hint", async () => {
    const detail = '"1HGC" is not a VIN: a VIN is 17 characters from A-Z (never I, O or Q) and 0-9; a partial VIN is at least 5 of them with * for each unknown position.';
    const { fetchImpl } = mockFetch([problem(400, "Invalid VIN", detail, "req_vin400")]);
    expect(await run(["vin", "1HGC"], fetchImpl)).toBe(1);
    expect(err.join("")).toBe(`✗ Invalid VIN: ${detail}\n  request id: req_vin400\n`);
  });

  it("keeps the catalog hint for a vehicle 404 and the generic hint for every other status", async () => {
    const { fetchImpl } = mockFetch([problem(404, "Vehicle not found", "porsche 912 2024 is not in the catalog.", "req_veh404")]);
    expect(await run(["get", "--make", "Porsche", "--model", "912", "--year", "2024"], fetchImpl)).toBe(1);
    expect(err.join("")).toContain(`→ ${fixHintFor(404)}`);
    for (const status of [0, 400, 401, 402, 403, 429, 502, 503]) {
      expect(vinFixHint(status, 7), String(status)).toBe(fixHintFor(status, 7));
    }
  });
});
