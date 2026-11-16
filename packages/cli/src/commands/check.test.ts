import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VehicleCheckResult } from "@meterapp/car-image-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";
import { parseCsv } from "../vehicle-list.js";

let dir: string;
let out: string[];
let err: string[];

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", CAR_IMAGE_API_KEY: "cimg_test", NO_COLOR: "1", ...extra };
}

function io() {
  return {
    stdout: (text: string) => void out.push(text),
    stderr: (text: string) => void err.push(text),
    isTTY: false,
    stdinTTY: false,
    color: false,
  };
}

/** Answers each check with the given results, re-indexed per request the way the server numbers them. */
function checkServer(answer: (entries: Array<Record<string, unknown>>) => VehicleCheckResult[]) {
  const seen: Array<{ url: string; method: string; body: { vehicles: Array<Record<string, unknown>> } }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { vehicles: Array<Record<string, unknown>> };
    seen.push({ url: String(input), method: init?.method ?? "GET", body });
    const results = answer(body.vehicles);
    const count = (status: string) => results.filter((result) => result.status === status).length;
    return Response.json({
      data: {
        summary: { total: results.length, match: count("match"), suggestion: count("suggestion"), miss: count("miss"), invalid: count("invalid"), distinct_vehicles: new Set(results.map((result) => result.vehicle?.id).filter(Boolean)).size },
        results,
      },
      request_id: `req_${seen.length}`,
    });
  };
  return { fetchImpl, seen };
}

const mx5 = (index: number, match = "alias"): VehicleCheckResult => ({
  index,
  status: "match",
  vehicle: { id: "veh_59854qbgfvar3", make: "mazda", make_name: "Mazda", model: "mx-5", model_name: "MX-5", year: 2018, match: match as "alias", image_path: "/api/v1/images/car?vehicle=veh_59854qbgfvar3" },
});

function run(argv: string[], fetchImpl?: typeof fetch, extraEnv: Record<string, string> = {}) {
  return main(argv, { env: env(extraEnv), io: io(), fetch: fetchImpl, skipUpdateCheck: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-check-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("car-image check", () => {
  it("checks a CSV, prints what did not match and writes every row back with its vehicle id", async () => {
    const input = join(dir, "inventory.csv");
    const output = join(dir, "checked.csv");
    await writeFile(input, "sku,make,model,year\nA1,Mazda,MX-5 Miata,2018\nA2,Lexus,TX 350,2022\nA3,Toyota,Zzyzx,2024\n");
    const { fetchImpl, seen } = checkServer(() => [
      mx5(0),
      { index: 1, status: "suggestion", vehicle: null, reason: "year", suggestions: [{ make: "lexus", make_name: "Lexus", model: "tx-350", model_name: "TX 350", year: 2024, id: "veh_8bbz514ey4ran", image_path: "/api/v1/images/car?vehicle=veh_8bbz514ey4ran" }] },
      { index: 2, status: "miss", vehicle: null, reason: "model", suggestions: [], search: "/api/v1/vehicles?q=toyota%20zzyzx" },
    ]);
    expect(await run(["check", input, "--out", output], fetchImpl)).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: "https://api.test/api/v1/vehicles/check", method: "POST" });
    expect(seen[0]?.body.vehicles).toEqual([
      { make: "Mazda", model: "MX-5 Miata", year: "2018" },
      { make: "Lexus", model: "TX 350", year: "2022" },
      { make: "Toyota", model: "Zzyzx", year: "2024" },
    ]);
    const text = out.join("");
    expect(text).toContain("Checked 3 vehicles: 1 match, 1 with suggestions, 1 missing.");
    expect(text).toContain("1 distinct vehicle to render");
    expect(text).toMatch(/2\s+2022 Lexus TX 350\s+suggestion\s+year\s+lexus\/tx-350 2024 veh_8bbz514ey4ran/);
    expect(text).toMatch(/3\s+2024 Toyota Zzyzx\s+miss\s+model\s+try GET \/api\/v1\/vehicles\?q=toyota%20zzyzx/);
    expect(text).toContain("Request a missing vehicle with: car-image request vehicle Toyota Zzyzx --year 2024 (you'll get an email when it's added).");
    expect(text).toContain(`Wrote ${output}: every entry with its answer (the vehicle_id column is the id to store).`);
    const [header, first] = parseCsv(await readFile(output, "utf8"));
    expect(header?.slice(0, 6)).toEqual(["sku", "make", "model", "year", "status", "vehicle_id"]);
    expect(first?.slice(0, 6)).toEqual(["A1", "Mazda", "MX-5 Miata", "2018", "match", "veh_59854qbgfvar3"]);
  });

  it("with --views, writes how many of each match's nine views are prepared and which are missing", async () => {
    const input = join(dir, "inventory.csv");
    const output = join(dir, "manifest.csv");
    await writeFile(input, "sku,make,model,year\nA1,Mazda,MX-5 Miata,2018\nA2,Toyota,Zzyzx,2024\n");
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        data: {
          summary: { total: 2, match: 1, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 1, views_complete: 0 },
          results: [{ ...mx5(0), views: { prepared: 6, missing: ["rear", "side-right"], verified: ["front", "side"] } }, { index: 1, status: "miss", vehicle: null, reason: "model", suggestions: [] }],
        },
        request_id: "req_1",
      });
    };
    // --views takes a list for `packs`, so the parser hands it the next word: here that word is the file.
    expect(await run(["check", "--views", input, "--out", output], fetchImpl)).toBe(0);
    expect(bodies[0]).toMatchObject({ views: true });
    expect(out.join("")).toContain("0 of 1 with all nine views prepared (views_prepared and views_missing columns)");
    const [header, first, second] = parseCsv(await readFile(output, "utf8"));
    expect(header?.slice(-3)).toEqual(["views_prepared", "views_missing", "views_verified"]);
    expect(first?.slice(-3)).toEqual(["6", "rear side-right", "front side"]);
    expect(second?.slice(-3)).toEqual(["", "", ""]);
    // No vehicle has every prepared view verified, so the summary says nothing about verification.
    expect(out.join("")).not.toContain("verified");

    expect(await run(["check", input, "--views", "front"], fetchImpl)).toBe(2);
    expect(err.join("")).toContain("--views takes no value");
    // --views=true and --views=false read as the switch they spell.
    expect(await run(["check", input, "--views=true", "--json"], fetchImpl)).toBe(0);
    expect(bodies.at(-1)).toMatchObject({ views: true });
    expect(await run(["check", input, "--views=false", "--json"], fetchImpl)).toBe(0);
    expect(bodies.at(-1)).not.toHaveProperty("views");
  });

  it("without --views, asks for no views and writes no view columns", async () => {
    const input = join(dir, "inventory.csv");
    const output = join(dir, "checked.csv");
    await writeFile(input, "make,model,year\nMazda,MX-5 Miata,2018\n");
    const { fetchImpl, seen } = checkServer(() => [mx5(0)]);
    expect(await run(["check", input, "--out", output], fetchImpl)).toBe(0);
    expect(seen[0]?.body).not.toHaveProperty("views");
    const [header] = parseCsv(await readFile(output, "utf8"));
    expect(header).not.toContain("views_prepared");
  });

  it("sends a long list in batches of 2,000, numbering every answer across the whole list", async () => {
    const input = join(dir, "big.json");
    await writeFile(input, JSON.stringify(Array.from({ length: 4_500 }, (_, index) => ({ make: "Mazda", model: "MX-5", year: 2018, ref: index }))));
    const { fetchImpl, seen } = checkServer((entries) => entries.map((_, index) => mx5(index, "exact")));
    expect(await run(["check", input, "--json"], fetchImpl)).toBe(0);
    expect(seen.map((call) => call.body.vehicles.length)).toEqual([2_000, 2_000, 500]);
    const result = JSON.parse(out.join("")) as { data: { summary: { total: number; match: number; distinct_vehicles: number }; results: Array<{ index: number; input: { ref: number } }> } };
    expect(result.data.summary).toMatchObject({ total: 4_500, match: 4_500, distinct_vehicles: 1 });
    expect(result.data.results[4_499]).toMatchObject({ index: 4_499, input: { ref: 4_499 } });
  });

  it("says when matches were read loosely and saves JSON beside a JSON list", async () => {
    const input = join(dir, "list.json");
    const output = join(dir, "checked.json");
    await writeFile(input, JSON.stringify({ vehicles: [{ make: "Mazda", model: "MX5 Miatta", year: 2018 }] }));
    const { fetchImpl } = checkServer(() => [mx5(0, "fuzzy")]);
    expect(await run(["check", input, "--out", output], fetchImpl)).toBe(0);
    expect(out.join("")).toContain("1 matched by a looser reading of the name (trim words, a badge or a typo): worth a glance.");
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ data: { results: [{ status: "match", input: { model: "MX5 Miatta" } }] } });
  });

  it("shows how to request a miss only when there is one, quoting a make of two words", async () => {
    const input = join(dir, "list.csv");
    await writeFile(input, "make,model,year\nMazda,MX-5,2018\nLand Rover,Defender Sport,2027\nBMW,iX4,2027\n");
    const { fetchImpl } = checkServer(() => [
      mx5(0),
      { index: 1, status: "miss", vehicle: null, reason: "model", suggestions: [] },
      { index: 2, status: "miss", vehicle: null, reason: "model", suggestions: [] },
    ]);
    expect(await run(["check", input], fetchImpl)).toBe(0);
    const hints = out.join("").split("\n").filter((line) => line.startsWith("Request a missing vehicle"));
    expect(hints).toEqual(['Request a missing vehicle with: car-image request vehicle "Land Rover" "Defender Sport" --year 2027 (you\'ll get an email when it\'s added).']);

    out = [];
    const ids = join(dir, "ids.csv");
    await writeFile(ids, "vehicle\nveh_0000000000000\n");
    expect(await run(["check", ids], checkServer(() => [{ index: 0, status: "miss", vehicle: null, reason: "vehicle", suggestions: [] }]).fetchImpl)).toBe(0);
    expect(out.join("")).toContain("car-image request vehicle <Make> <Model> --year <YYYY>");

    out = [];
    expect(await run(["check", ids], checkServer(() => [mx5(0)]).fetchImpl)).toBe(0);
    expect(out.join("")).not.toContain("Request a missing vehicle");
  });

  it("needs a list, a readable file and a key", async () => {
    expect(await run(["check"])).toBe(2);
    expect(err.join("")).toContain("Missing the list to check");
    err = [];
    expect(await run(["check", join(dir, "nope.csv")])).toBe(2);
    expect(err.join("")).toContain("Cannot read");
    err = [];
    const input = join(dir, "list.csv");
    await writeFile(input, "make,model,year\nKia,EV6,2024\n");
    expect(await run(["check", input], undefined, { CAR_IMAGE_API_KEY: "" })).toBe(1);
    expect(err.join("")).toContain("Not signed in.");
  });
});
