import { describe, expect, it, vi } from "vitest";
import { CarImageClient } from "./client.js";
import { CarImageError } from "./errors.js";

interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: unknown;
}

function problem(status: number, title: string, detail: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ type: `https://carimage.dev/docs/errors#${status}`, title, status, detail, request_id: "req_123", ...extra }), {
    status,
    headers: { "Content-Type": "application/problem+json", "X-Request-Id": "req_123", ...headers },
  });
}

function mockFetch(responses: Array<Response | (() => Response) | Error>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url: String(input), init: init ?? {}, headers, body });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch call");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  return { fetchImpl, calls };
}

const sleep = vi.fn(async (ms: number) => {
  void ms;
});

function client(responses: Array<Response | (() => Response) | Error>, options: ConstructorParameters<typeof CarImageClient>[0] = {}) {
  const { fetchImpl, calls } = mockFetch(responses);
  const instance = new CarImageClient({ apiKey: "cimg_testkey_0123456789abcdef0123456789abc", baseUrl: "https://api.example.test/", fetch: fetchImpl, sleep, ...options });
  return { instance, calls, fetchImpl };
}

describe("CarImageClient", () => {
  it("normalizes the base URL and never exposes the key", () => {
    const { instance } = client([]);
    expect(instance.baseUrl).toBe("https://api.example.test");
    expect(instance.hasApiKey).toBe(true);
    expect(instance.maskedApiKey()).toMatch(/^cimg_test…abc$/);
    expect(JSON.stringify(instance)).not.toContain("cimg_testkey");
  });

  it("getImage sends auth, user agent and image accept, then parses billing headers", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const { instance, calls } = client([
      new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "X-Credits-Charged": "1",
          "X-Credits-Remaining": "99",
          "X-Image-Source": "cache",
          "X-Image-Width": "512",
          "X-Image-Height": "512",
          ETag: '"abc"',
          "X-Request-Id": "req_1",
        },
      }),
    ]);
    const result = await instance.getImage({ make: "Porsche", model: "911", year: 2024, view: "side", color: "red", size: "small", format: "png" });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/images/car?make=Porsche&model=911&year=2024&view=side&color=red&size=small&format=png");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer cimg_testkey_0123456789abcdef0123456789abc");
    expect(calls[0]?.headers.get("user-agent")).toMatch(/^car-image-sdk\/\d+\.\d+\.\d+$/);
    expect(calls[0]?.headers.get("accept")).toContain("image/png");
    expect(result.bytes).toEqual(bytes);
    expect(result).toMatchObject({ contentType: "image/png", creditsCharged: 1, creditsRemaining: 99, source: "cache", width: 512, height: 512, etag: '"abc"', requestId: "req_1" });
    // No X-Vehicle-Id (a server that predates it): unknown, not guessed.
    expect(result.vehicleId).toBeNull();
  });

  it("getImage reads the served vehicle's id from X-Vehicle-Id, and only a well-formed one", async () => {
    const png = () => new Uint8Array([137, 80, 78, 71]);
    const { instance } = client([
      new Response(png(), { status: 200, headers: { "Content-Type": "image/png", "X-Vehicle-Id": "veh_395yw8tn73ff8" } }),
      new Response(png(), { status: 200, headers: { "Content-Type": "image/png", "X-Vehicle-Id": "not-an-id" } }),
    ]);
    expect((await instance.getImage({ make: "Porsche", model: "911", year: 2024 })).vehicleId).toBe("veh_395yw8tn73ff8");
    expect((await instance.getImage({ make: "Porsche", model: "911", year: 2024 })).vehicleId).toBeNull();
  });

  it("getImageUrl asks for JSON", async () => {
    const payload = { data: { url: "https://api.example.test/api/v1/delivery/t", expires_at: "2026-01-01T00:00:00Z", vehicle: {}, width: 1024, height: 1024, format: "png" }, billing: { credits_charged: 1, credits_remaining: 98 }, request_id: "req_2" };
    const { instance, calls } = client([Response.json(payload)]);
    const result = await instance.getImageUrl({ make: "bmw", model: "m3", year: "2022" });
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
    expect(calls[0]?.url).toContain("year=2022");
    expect(result.data.url).toBe(payload.data.url);
  });

  it("cachedImageUrl builds the keyless mode=cached URL from the image parameters", () => {
    const { instance, calls } = client([]);
    expect(instance.cachedImageUrl({ vehicle: "veh_395yw8tn73ff8", view: "side", color: "#1a2b3c", width: 600, format: "webp" })).toBe(
      "https://api.example.test/images/car.png?vehicle=veh_395yw8tn73ff8&view=side&color=1a2b3c&w=600&format=webp&mode=cached"
    );
    expect(instance.cachedImageUrl({ make: "Porsche", model: "911", year: 2024 })).toBe("https://api.example.test/images/car.png?make=Porsche&model=911&year=2024&mode=cached");
    expect(calls).toHaveLength(0);
  });

  it("isImageReady asks the mode=cached URL without the key: 200 and 401 signed_url_required are true, 404 not_cached false", async () => {
    const { instance, calls } = client([
      new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png", "X-Image-Source": "cache" } }),
      // Rendered, but not a public preview: delivered through a signed URL or a key.
      problem(401, "Signed URL required", "This image is rendered.", { code: "signed_url_required", cached: true }),
      problem(404, "Image not cached", "This variant has not been rendered yet.", { code: "not_cached" }),
      // A server from before the code answered with the title alone.
      problem(404, "Image not cached", "This variant has not been rendered yet."),
    ]);
    const params = { vehicle: "veh_395yw8tn73ff8" as const, view: "front-3-4" as const };
    expect(await instance.isImageReady(params)).toBe(true);
    expect(await instance.isImageReady(params)).toBe(true);
    expect(await instance.isImageReady(params)).toBe(false);
    expect(await instance.isImageReady(params)).toBe(false);
    expect(calls[0]?.url).toBe("https://api.example.test/images/car.png?vehicle=veh_395yw8tn73ff8&view=front-3-4&mode=cached");
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.headers.get("authorization")).toBeNull();
      expect(call.headers.get("user-agent")).toBeNull();
    }
  });

  it("isImageReady throws on any other answer, an unknown vehicle id included", async () => {
    const { instance } = client([
      problem(404, "Vehicle not found", "No catalog vehicle has the id veh_0000000000000.", { code: "vehicle_not_found", parameter: "vehicle" }),
      problem(400, "Invalid image parameters", "view is not a camera view.", { code: "invalid_params" }),
    ]);
    const error = await instance.isImageReady({ vehicle: "veh_0000000000000" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CarImageError);
    expect((error as CarImageError).status).toBe(404);
    expect((error as CarImageError).problem?.code).toBe("vehicle_not_found");
    await expect(instance.isImageReady({ vehicle: "veh_0000000000000" })).rejects.toMatchObject({ status: 400 });
  });

  it("createImageUrls maps params (size -> width), ttl and max uses", async () => {
    const { instance, calls } = client([Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 2, credits_remaining: 90 }, request_id: "r" }, { status: 201 })]);
    await instance.createImageUrls([{ make: "Audi", model: "A4", year: 2020, size: "thumb" }, { make: "Audi", model: "A6", year: 2021, width: 300, format: "webp" }], { ttlSeconds: 600, maxUses: 3 });
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.body).toEqual({
      images: [
        { make: "Audi", model: "A4", year: 2020, width: 256 },
        { make: "Audi", model: "A6", year: 2021, width: 300, format: "webp" },
      ],
      ttl_seconds: 600,
      max_uses: 3,
    });
  });

  it("createImageUrls sends an Idempotency-Key, generated or given, and retries the POST under it", async () => {
    const { instance, calls } = client([Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 90 }, request_id: "r" }, { status: 201 }), Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 90 }, request_id: "r" }, { status: 201 })]);
    await instance.createImageUrls({ make: "Porsche", model: "911", year: 2024 });
    expect(calls[0]?.headers.get("idempotency-key")).toMatch(/^sdk_[0-9a-f-]{36}$/);
    await instance.createImageUrls({ make: "Porsche", model: "911", year: 2024 }, { idempotencyKey: "order-42" });
    expect(calls[1]?.headers.get("idempotency-key")).toBe("order-42");
    expect(calls[0]?.headers.get("idempotency-key")).not.toBe(calls[1]?.headers.get("idempotency-key"));
  });

  it("createImageUrls reports a replay from the Idempotent-Replayed header, and nothing otherwise", async () => {
    const payload = { data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 90 }, request_id: "r" };
    const { instance } = client([
      Response.json(payload, { status: 201 }),
      Response.json(payload, { status: 201, headers: { "Idempotent-Replayed": "true" } }),
    ]);
    const minted = await instance.createImageUrls({ make: "Porsche", model: "911", year: 2024 }, { idempotencyKey: "order-42" });
    expect(minted.idempotent_replayed).toBeUndefined();
    const replayed = await instance.createImageUrls({ make: "Porsche", model: "911", year: 2024 }, { idempotencyKey: "order-42" });
    expect(replayed.idempotent_replayed).toBe(true);
  });

  it("createImageUrls forwards renew and renewDays", async () => {
    const { instance, calls } = client([Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 90 }, request_id: "r" }, { status: 201 })]);
    await instance.createImageUrls({ make: "Porsche", model: "911", year: 2024 }, { ttlSeconds: 604_800, renew: true, renewDays: 90 });
    expect(calls[0]?.body).toEqual({ images: [{ make: "Porsche", model: "911", year: 2024 }], ttl_seconds: 604_800, renew: true, renew_days: 90 });
  });

  it("createImageUrls rejects empty and oversized batches locally", async () => {
    const { instance, fetchImpl } = client([]);
    await expect(instance.createImageUrls([])).rejects.toThrow(RangeError);
    await expect(instance.createImageUrls(Array.from({ length: 51 }, () => ({ make: "a", model: "b", year: 2000 })))).rejects.toThrow(/1 to 50/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates image params before any network call", async () => {
    const { instance, fetchImpl } = client([]);
    await expect(instance.getImage({ make: "", model: "911", year: 2024 })).rejects.toThrow(/make is required/);
    await expect(instance.getImage({ make: "Porsche", model: "911", year: "soon" })).rejects.toThrow(/Invalid year/);
    await expect(instance.getImage({ make: "Porsche", model: "911", year: 2024, width: 0 })).rejects.toThrow(/width/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces problem+json as CarImageError and never retries 402", async () => {
    const { instance, fetchImpl } = client([problem(402, "Insufficient credits", "This request needs 1 credit; balance is 0", { balance: 0, required_credits: 1 })]);
    const error = await instance.getImage({ make: "Porsche", model: "911", year: 2024 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CarImageError);
    const typed = error as CarImageError;
    expect(typed.status).toBe(402);
    expect(typed.title).toBe("Insufficient credits");
    expect(typed.detail).toContain("balance is 0");
    expect(typed.requestId).toBe("req_123");
    expect(typed.problem?.balance).toBe(0);
    expect(typed.isInsufficientCredits).toBe(true);
    expect(typed.message).toContain("request req_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 honoring Retry-After and 503 with backoff, up to maxRetries", async () => {
    sleep.mockClear();
    const { instance, fetchImpl } = client([
      problem(429, "Rate limit exceeded", "slow down", {}, { "Retry-After": "2" }),
      problem(503, "Unavailable", "try later"),
      Response.json({ data: { credits: 42 }, request_id: "r" }),
    ]);
    const account = await instance.account();
    expect(account.data.credits).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
    const backoff = sleep.mock.calls[1]?.[0] as number;
    expect(backoff).toBeGreaterThanOrEqual(0);
    expect(backoff).toBeLessThanOrEqual(1000);
  });

  it("gives up after maxRetries and throws the last problem", async () => {
    const { instance, fetchImpl } = client([problem(429, "Rate limit exceeded", "a", {}, { "Retry-After": "1" }), problem(429, "Rate limit exceeded", "b", {}, { "Retry-After": "1" }), problem(429, "Rate limit exceeded", "c", {}, { "Retry-After": "1" })]);
    const error = (await instance.account().catch((e: unknown) => e)) as CarImageError;
    expect(error.status).toBe(429);
    expect(error.detail).toBe("c");
    expect(error.retryAfterSeconds).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 503 whose Retry-After is longer than maxRetryDelayMs, and says when (#72)", async () => {
    sleep.mockClear();
    const { instance, fetchImpl } = client([
      problem(503, "Image generation at capacity", "resumes at midnight UTC", { code: "generation_at_capacity", retry_after_seconds: 30000 }, { "Retry-After": "30000" }),
      Response.json({ data: { credits: 42 }, request_id: "r" }),
    ]);
    const error = (await instance.account().catch((e: unknown) => e)) as CarImageError;
    expect(error.status).toBe(503);
    expect(error.retryAfterSeconds).toBe(30000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("respects a per-call retries override", async () => {
    const { instance, fetchImpl } = client([problem(503, "Unavailable", "x")]);
    await expect(instance.account({ retries: 0 })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network failures for GET and for a POST under an Idempotency-Key, but not for other POSTs", async () => {
    const { instance: getter, fetchImpl: getFetch } = client([new TypeError("fetch failed"), Response.json({ status: "ok", checks: {} })]);
    await expect(getter.health()).resolves.toMatchObject({ status: "ok" });
    expect(getFetch).toHaveBeenCalledTimes(2);

    const { instance: poster, fetchImpl: postFetch } = client([new TypeError("fetch failed")]);
    const error = (await poster.resolve("red 911").catch((e: unknown) => e)) as CarImageError;
    expect(error).toBeInstanceOf(CarImageError);
    expect(error.status).toBe(0);
    expect(error.title).toBe("Network error");
    expect(postFetch).toHaveBeenCalledTimes(1);

    // The key makes the retry safe: the server replays rather than bills again.
    const created = Response.json({ data: [], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 90 }, request_id: "r" }, { status: 201 });
    const { instance: keyed, fetchImpl: keyedFetch, calls } = client([new TypeError("fetch failed"), created]);
    await expect(keyed.createImageUrls({ make: "a", model: "b", year: 2000 })).resolves.toMatchObject({ request_id: "r" });
    expect(keyedFetch).toHaveBeenCalledTimes(2);
    expect(calls[0]?.headers.get("idempotency-key")).toBe(calls[1]?.headers.get("idempotency-key"));
  });

  it("requires a key for authenticated endpoints but not public ones", async () => {
    const { fetchImpl, calls } = mockFetch([Response.json({ data: { years: [2024] } })]);
    const anonymous = new CarImageClient({ apiKey: "", baseUrl: "https://api.example.test", fetch: fetchImpl, sleep });
    // Guard against an ambient CAR_IMAGE_API_KEY in the test environment.
    if (anonymous.hasApiKey) return;
    await expect(anonymous.account()).rejects.toMatchObject({ status: 401, title: "API key required" });
    await anonymous.vehicles();
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("builds vehicles and search queries", async () => {
    const { instance, calls } = client([Response.json({ data: {} }), Response.json({ data: {} }), Response.json({ data: {} })]);
    await instance.vehicles({ year: 2024 });
    await instance.vehicles({ year: 2024, makeId: 7 });
    await instance.searchVehicles("porsche 911", { limit: 5 });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/vehicles?year=2024");
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/vehicles?year=2024&makeId=7");
    expect(calls[2]?.url).toBe("https://api.example.test/api/v1/vehicles?q=porsche+911&limit=5");
  });

  it("checkVehicles posts the list, splits it into batches and merges the answers", async () => {
    const answer = (results: Array<Record<string, unknown>>, request_id: string) =>
      Response.json({
        data: {
          summary: {
            total: results.length,
            match: results.filter((result) => result.status === "match").length,
            suggestion: results.filter((result) => result.status === "suggestion").length,
            miss: results.filter((result) => result.status === "miss").length,
            invalid: 0,
            distinct_vehicles: new Set(results.map((result) => (result.vehicle as { id?: string } | null)?.id).filter(Boolean)).size,
          },
          results,
        },
        request_id,
      });
    const match = (index: number, id: string) => ({ index, status: "match", vehicle: { id, make: "mazda", model: "mx-5", year: 2018 } });
    const { instance, calls } = client([
      answer([match(0, "veh_a"), match(1, "veh_b")], "req_1"),
      answer([match(0, "veh_a"), { index: 1, status: "miss", vehicle: null, reason: "model", suggestions: [] }], "req_2"),
      answer([{ index: 0, status: "suggestion", vehicle: null, reason: "year", suggestions: [] }], "req_3"),
    ]);
    const progress: Array<[number, number]> = [];
    const entries = [
      { make: "Mazda", model: "MX-5 Miata", year: 2018, ref: "row-1" },
      { vehicle: "veh_395yw8tn73ff8" },
      { make: "Mazda", model: "MX-5", year: "2018" },
      { make: "Toyota", model: "Zzyzx", year: 2024 },
      { make: "Lexus", model: "TX 350", year: 2022 },
    ];
    const result = await instance.checkVehicles(entries, { batchSize: 2, onProgress: (checked, total) => progress.push([checked, total]) });
    expect(calls.map((call) => [call.url, call.init.method])).toEqual([
      ["https://api.example.test/api/v1/vehicles/check", "POST"],
      ["https://api.example.test/api/v1/vehicles/check", "POST"],
      ["https://api.example.test/api/v1/vehicles/check", "POST"],
    ]);
    expect(calls[0]?.body).toEqual({ vehicles: entries.slice(0, 2) });
    expect(calls[2]?.body).toEqual({ vehicles: entries.slice(4) });
    expect(calls[0]?.headers.get("authorization")).toMatch(/^Bearer cimg_/);
    expect(result.data.results.map((entry) => [entry.index, entry.status])).toEqual([
      [0, "match"],
      [1, "match"],
      [2, "match"],
      [3, "miss"],
      [4, "suggestion"],
    ]);
    expect(result.data.summary).toEqual({ total: 5, match: 3, suggestion: 1, miss: 1, invalid: 0, distinct_vehicles: 2 });
    expect(result.request_id).toBe("req_3");
    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it("checkVehicles repeats a check after a dropped connection and refuses bad input locally", async () => {
    const empty = { data: { summary: { total: 1, match: 0, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 0 }, results: [] }, request_id: "r" };
    const { instance, fetchImpl } = client([new TypeError("fetch failed"), Response.json(empty)]);
    await expect(instance.checkVehicles([{ make: "a", model: "b", year: 2000 }])).resolves.toMatchObject({ request_id: "r" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(instance.checkVehicles([])).rejects.toThrow(TypeError);
    await expect(instance.checkVehicles([{ vehicle: "veh_395yw8tn73ff8" }], { batchSize: 2_001 })).rejects.toThrow(RangeError);
    await expect(instance.checkVehicles([{ vehicle: "veh_395yw8tn73ff8" }], { batchSize: 0 })).rejects.toThrow(RangeError);
  });

  it("checkVehicles with views sends 100 a request, asks for views and counts the complete vehicles", async () => {
    const views = (prepared: number, missing: string[]) => ({ prepared, missing });
    const match = (index: number, id: string, answer: ReturnType<typeof views>) => ({ index, status: "match", vehicle: { id, make: "ford", model: "f-150", year: 2023 }, views: answer });
    const page = (results: Array<Record<string, unknown>>, request_id: string) =>
      Response.json({ data: { summary: { total: results.length, match: results.length, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: results.length, views_complete: 0 }, results }, request_id });
    const entries = Array.from({ length: 150 }, (_, index) => ({ vehicle: "veh_395yw8tn73ff8", ref: index }));
    const { instance, calls } = client([
      page([match(0, "veh_a", views(8, [])), match(1, "veh_b", views(6, ["rear", "side-right"]))], "req_1"),
      page([match(0, "veh_a", views(8, [])), match(1, "veh_c", views(8, []))], "req_2"),
    ]);
    const result = await instance.checkVehicles(entries, { views: true });
    expect(calls.map((call) => (call.body as { vehicles: unknown[] }).vehicles.length)).toEqual([100, 50]);
    expect(calls.every((call) => (call.body as { views?: boolean }).views === true)).toBe(true);
    expect(result.data.results[1]?.views).toEqual({ prepared: 6, missing: ["rear", "side-right"] });
    expect(result.data.results.map((entry) => entry.index)).toEqual([0, 1, 100, 101]);
    // Counted across requests by id, as distinct_vehicles is: veh_a twice, veh_c, never veh_b.
    expect(result.data.summary).toMatchObject({ distinct_vehicles: 3, views_complete: 2 });
    await expect(instance.checkVehicles(entries, { views: true, batchSize: 101 })).rejects.toThrow("batchSize must be an integer from 1 to 100 with views");
  });

  it("checkVehicles with views counts the vehicles whose every prepared view is verified, across requests", async () => {
    const match = (index: number, id: string, views: Record<string, unknown>) => ({ index, status: "match", vehicle: { id, make: "ford", model: "f-150", year: 2023 }, views });
    const page = (results: Array<Record<string, unknown>>, request_id: string) =>
      Response.json({ data: { summary: { total: results.length, match: results.length, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: results.length, views_complete: 0, views_verified: 0 }, results }, request_id });
    const entries = Array.from({ length: 150 }, (_, index) => ({ vehicle: "veh_395yw8tn73ff8", ref: index }));
    const { instance } = client([
      page([
        match(0, "veh_a", { prepared: 2, missing: ["rear"], verified: ["front", "side"] }), // every prepared view verified
        match(1, "veh_b", { prepared: 2, missing: [], verified: ["front"] }), // one of two
      ], "req_1"),
      page([
        match(0, "veh_a", { prepared: 2, missing: ["rear"], verified: ["front", "side"] }), // the same vehicle again: counted once
        match(1, "veh_c", { prepared: 0, missing: ["front"], verified: [] }), // nothing prepared: nothing to count
        match(2, "veh_d", { prepared: 1, missing: [] }), // a server that predates the field
      ], "req_2"),
    ]);
    const result = await instance.checkVehicles(entries, { views: true });
    expect(result.data.summary.views_verified).toBe(1);
    expect(result.data.results[0]?.views?.verified).toEqual(["front", "side"]);
  });

  it("checkVehicles waits out the account's checks a minute instead of failing a long list halfway", async () => {
    const limited = () => Response.json({ status: 429, title: "Too many checks", detail: "Wait 45 seconds." }, { status: 429, headers: { "Retry-After": "45", "Content-Type": "application/problem+json" } });
    const ok = (request_id: string) => Response.json({ data: { summary: { total: 1, match: 0, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 0 }, results: [{ index: 0, status: "miss", vehicle: null }] }, request_id });
    const two = [{ make: "a", model: "b", year: 2000 }, { make: "c", model: "d", year: 2000 }];
    const waited: number[] = [];
    const { instance, fetchImpl } = client([ok("req_1"), limited, ok("req_2")], { sleep: async (ms) => void waited.push(ms) });
    const result = await instance.checkVehicles(two, { batchSize: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2 + 1);
    expect(waited).toEqual([45_000]);
    expect(result).toMatchObject({ request_id: "req_2", data: { summary: { total: 2, miss: 2 } } });

    // At most three waits for one request.
    const stubbornWaits: number[] = [];
    const { instance: stubborn } = client([ok("req_1"), limited, limited, limited, limited], { sleep: async (ms) => void stubbornWaits.push(ms) });
    await expect(stubborn.checkVehicles(two, { batchSize: 1 })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 45 });
    expect(stubbornWaits).toHaveLength(3);

    // A single request (the MCP tool's), or retries turned off, answers the 429 at once.
    const never = vi.fn(async () => {});
    await expect(client([limited], { sleep: never }).instance.checkVehicles([two[0]!])).rejects.toMatchObject({ status: 429 });
    await expect(client([ok("req_1"), limited], { sleep: never, maxRetries: 0 }).instance.checkVehicles(two, { batchSize: 1 })).rejects.toMatchObject({ status: 429 });
    expect(never).not.toHaveBeenCalled();

    // An abort ends the wait.
    const controller = new AbortController();
    const { instance: waiting } = client([ok("req_1"), limited], { sleep: () => new Promise(() => {}) });
    const pending = waiting.checkVehicles(two, { batchSize: 1, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
  });

  it("files an image report by image or by missing vehicle, and reads it back", async () => {
    const report = {
      object: "image_report", id: "0b9f3c1e-6a3e-4d55-9b52-0d1d2c6f7a10", url: "https://api.example.test/dashboard/image-reports/0b9f3c1e-6a3e-4d55-9b52-0d1d2c6f7a10",
      type: "wrong_image", status: "reported", flagged: false, category: "identity", asset_id: null,
      vehicle: { make: "Porsche", model: "911", year: 2024 }, report_count: 1, created_at: "2026-11-23T00:00:00Z",
    };
    const { instance, calls } = client([
      Response.json({ data: report, created: true, request_id: "a" }, { status: 201 }),
      Response.json({ data: report, created: false, request_id: "b" }),
      Response.json({ data: { ...report, type: "missing_vehicle", category: null }, created: true, request_id: "c" }, { status: 201 }),
      Response.json({ data: { ...report, type: "poor_quality", category: "quality" }, created: true, request_id: "d" }, { status: 201 }),
      Response.json({ data: report, request_id: "e" }),
    ]);
    const filed = await instance.reportImage({ requestId: " req_01JD7X2Q ", category: "identity", reason: " Shows the previous generation ", externalRef: "meter-report-4812" });
    expect(filed).toMatchObject({ created: true, data: { id: report.id, status: "reported" } });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/images/reports");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ request_id: "req_01JD7X2Q", category: "identity", reason: "Shows the previous generation", external_ref: "meter-report-4812" });

    expect((await instance.reportImage({ type: "wrong_image", vehicle: "veh_395yw8tn73ff8", view: "side", color: "red", category: "paint" })).created).toBe(false);
    expect(calls[1]?.body).toEqual({ type: "wrong_image", category: "paint", vehicle: "veh_395yw8tn73ff8", view: "side", color: "red" });

    await instance.reportImage({ type: "missing_vehicle", make: "Rivian", model: "R3", year: "2026", externalRef: "meter-report-4813" });
    expect(calls[2]?.body).toEqual({ type: "missing_vehicle", make: "Rivian", model: "R3", year: 2026, external_ref: "meter-report-4813" });

    await instance.reportImage({ type: "poor_quality", assetId: "6f1c2d4e-0000-4000-8000-000000000001" });
    expect(calls[3]?.body).toEqual({ type: "poor_quality", asset_id: "6f1c2d4e-0000-4000-8000-000000000001" });

    expect((await instance.getImageReport(report.id)).data.id).toBe(report.id);
    expect(calls[4]?.url).toBe(`https://api.example.test/api/v1/images/reports/${report.id}`);
    expect(calls[4]?.init.method ?? "GET").toBe("GET");

    // Refused before a call: no target, a missing vehicle without a model, a reason or ref over the limit, an empty id.
    await expect(instance.reportImage({ category: "identity" } as never)).rejects.toThrow(/assetId, requestId/);
    await expect(instance.reportImage({ type: "missing_vehicle", make: "Rivian", model: " ", year: 2026 })).rejects.toThrow(/make and model/);
    await expect(instance.reportImage({ requestId: "r", reason: "x".repeat(501) })).rejects.toThrow(/at most 500/);
    await expect(instance.reportImage({ requestId: "r", externalRef: "x".repeat(101) })).rejects.toThrow(/at most 100/);
    await expect(instance.reportImage({ requestId: "r", type: "bogus" as never })).rejects.toThrow(/type must be one of/);
    await expect(instance.getImageReport(" ")).rejects.toThrow(/report id/);
    expect(calls).toHaveLength(5);
  });

  it("lists and reads requests without a key, sending the key when present", async () => {
    const record = { id: "req_1", kind: "vehicle", title: "Toyota Sienna (2024)", body: null, vehicle: { make: "Toyota", model: "Sienna", year: 2024 }, status: "open", votes: 3, comments: 0, author: "Ada", url: "https://api.example.test/requests/req_1", created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z" };
    const anonymous = new CarImageClient({ apiKey: "", baseUrl: "https://api.example.test", fetch: mockFetch([Response.json({ data: [record], next_cursor: null, request_id: "a" })]).fetchImpl, sleep });
    const list = await anonymous.listRequests({ kind: "vehicle", status: "open", sort: "top", limit: 5 });
    expect(list.data[0]?.id).toBe("req_1");

    const { instance, calls } = client([
      Response.json({ data: [record], next_cursor: "c2", request_id: "b" }),
      Response.json({ data: { ...record, comments: [] }, request_id: "c" }),
      Response.json({ data: [], request_id: "d" }),
    ]);
    await instance.listRequests({ sort: "new", cursor: "c1" });
    await instance.getRequest("req 1");
    await instance.listRequestComments("req_1");
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/requests?sort=new&cursor=c1");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toContain("Bearer");
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/requests/req%201");
    expect(calls[2]?.url).toBe("https://api.example.test/api/v1/requests/req_1/comments");
    await expect(instance.getRequest("  ")).rejects.toThrow(/request id/);
  });

  it("creates vehicle and feature requests and reports deduplication", async () => {
    const record = { id: "req_2", kind: "vehicle", title: "Toyota Sienna (2024)", votes: 4 };
    const { instance, calls } = client([
      Response.json({ data: record, deduplicated: true, request_id: "a" }, { status: 200 }),
      Response.json({ data: { ...record, id: "req_3", kind: "feature" }, deduplicated: false, request_id: "b" }, { status: 201 }),
    ]);
    const vehicle = await instance.createRequest({ kind: "vehicle", make: " Toyota ", model: "Sienna", year: "2024", body: "Needed for a dealer site" });
    expect(vehicle.deduplicated).toBe(true);
    expect(vehicle.data.id).toBe("req_2");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/requests");
    expect(calls[0]?.body).toEqual({ kind: "vehicle", make: "Toyota", model: "Sienna", year: 2024, body: "Needed for a dealer site" });
    const feature = await instance.createRequest({ kind: "feature", title: "Interior views" });
    expect(feature.deduplicated).toBe(false);
    expect(calls[1]?.body).toEqual({ kind: "feature", title: "Interior views" });
    await expect(instance.createRequest({ kind: "vehicle", make: "Toyota", model: "" })).rejects.toThrow(/make and model/);
    await expect(instance.createRequest({ kind: "feature", title: " " })).rejects.toThrow(/title/);
    const anonymous = new CarImageClient({ apiKey: "", baseUrl: "https://api.example.test", fetch: mockFetch([]).fetchImpl, sleep });
    await expect(anonymous.createRequest({ kind: "feature", title: "x" })).rejects.toMatchObject({ status: 401 });
  });

  it("votes, unvotes and comments on a request", async () => {
    const record = { id: "req_2", votes: 5 };
    const { instance, calls } = client([
      Response.json({ data: record, request_id: "a" }),
      Response.json({ data: { ...record, votes: 4 }, request_id: "b" }),
      Response.json({ data: { id: "cmt_1", request_id: "req_2", body: "Also need the hybrid", author: "Ada", created_at: "2026-09-11T00:00:00Z" }, request_id: "c" }, { status: 201 }),
    ]);
    expect((await instance.voteRequest("req_2")).data.votes).toBe(5);
    expect((await instance.unvoteRequest("req_2")).data.votes).toBe(4);
    const comment = await instance.commentOnRequest("req_2", "  Also need the hybrid ");
    expect(comment.data.id).toBe("cmt_1");
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/requests/req_2/votes");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[1]?.init.method).toBe("DELETE");
    expect(calls[2]?.url).toBe("https://api.example.test/api/v1/requests/req_2/comments");
    expect(calls[2]?.body).toEqual({ body: "Also need the hybrid" });
    await expect(instance.commentOnRequest("req_2", "   ")).rejects.toThrow(/body/);
  });

  it("shares what you are building and how you found the API", async () => {
    const { instance, calls } = client([
      Response.json({ data: { building: "A dealer inventory site", updated_at: "2026-09-11T00:00:00Z" }, request_id: "a" }),
      Response.json({ data: { source: "github", detail: "vehicle-db README", updated_at: "2026-09-11T00:00:00Z" }, request_id: "b" }),
    ]);
    await instance.shareBuilding(" A dealer inventory site ");
    await instance.shareReferral("github", "vehicle-db README");
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/account/building");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.headers.get("authorization")).toContain("Bearer");
    expect(calls[0]?.body).toEqual({ building: "A dealer inventory site" });
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/account/referral");
    expect(calls[1]?.body).toEqual({ source: "github", detail: "vehicle-db README" });
    await expect(instance.shareBuilding("")).rejects.toThrow(/building/);
    await expect(instance.shareReferral("carrier pigeon" as never)).rejects.toThrow(/source must be one of/);
  });

  it("polls device login without throwing on pending or expired", async () => {
    const { instance } = client([
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ error: "expired_token" }), { status: 400, headers: { "Content-Type": "application/json" } }),
      Response.json({ access_token: "cimg_new", token_type: "Bearer", scope: "images:read account:read billing:write" }),
    ]);
    expect(await instance.pollDeviceLogin("dev")).toEqual({ status: "pending" });
    expect(await instance.pollDeviceLogin("dev")).toEqual({ status: "expired" });
    expect(await instance.pollDeviceLogin("dev")).toMatchObject({ status: "approved", accessToken: "cimg_new" });
  });

  it("raw fetch only attaches the key to same-origin URLs", async () => {
    const { instance, calls } = client([new Response("ok"), new Response("ok")]);
    await instance.fetch("/api/v1/account");
    await instance.fetch("https://evil.example.net/steal");
    expect(calls[0]?.headers.get("authorization")).toContain("Bearer");
    expect(calls[1]?.headers.has("authorization")).toBe(false);
  });

  it("creates plan checkout and portal links, and sells no credits", async () => {
    const { instance, calls } = client([Response.json({ data: { url: "https://checkout.stripe.com/x", plan: "pro", interval: "month", amount_cents: 4900 } }, { status: 201 }), Response.json({ data: { url: "https://billing.stripe.com/p" } }, { status: 201 })]);
    const checkout = await instance.createPlanCheckout("pro");
    const portal = await instance.billingPortal();
    expect(calls[0]?.body).toEqual({ plan: "pro", interval: "month" });
    expect(checkout.data.amount_cents).toBe(4900);
    expect(portal.data.url).toContain("stripe");
    expect("createCheckout" in instance).toBe(false);
    await expect(instance.createCheckoutLink({ credits: 500 } as never)).rejects.toThrow(/no longer sold/);
    expect(calls).toHaveLength(2);
  });

  it("reads quality without generating and preserves an omitted view to check all views", async () => {
    const answer = { data: { object: "image_availability", views: [] }, request_id: "availability" };
    const { instance, calls } = client([Response.json(answer), Response.json(answer)]);
    expect(await instance.getImageAvailability({ vehicle: "veh_395yw8tn73ff8" })).toEqual(answer);
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/images/availability?vehicle=veh_395yw8tn73ff8");
    await instance.getImageAvailability({ vehicle: "veh_395yw8tn73ff8", view: "rear", color: "#1a2b3c" });
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/images/availability?vehicle=veh_395yw8tn73ff8&view=rear&color=1a2b3c");
    expect(calls.every((call) => (call.init.method ?? "GET") === "GET")).toBe(true);
  });

  it("checks availability for free and reads the vehicle-image meter's headers", async () => {
    const answer = { data: { object: "image_availability_check", images: [{ index: 0, prepared: false, counts_image: true, vehicle: { id: "veh_395yw8tn73ff8", make: "porsche", model: "911", year: 2024 }, view: "front", color: "red" }], summary: { items: 1, prepared: 0, not_prepared: 1 }, allowance: { period: { month_start: "2026-10-01T00:00:00.000Z" }, vehicle_images: { used: 4, included: 100, would_add: 1, fits: true } } }, request_id: "r" };
    const { instance, calls } = client([
      Response.json(answer),
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png", "X-Credits-Charged": "0", "X-Vehicle-Images-Used": "5", "X-Vehicle-Images-Included": "100" } }),
    ]);
    const checked = await instance.checkAvailability({ vehicle: "veh_395yw8tn73ff8", view: "front", color: "red" });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/images/availability");
    expect(calls[0]?.body).toEqual({ images: [{ vehicle: "veh_395yw8tn73ff8", view: "front", color: "red" }] });
    expect(checked.data.allowance?.vehicle_images.fits).toBe(true);
    await expect(instance.checkAvailability([])).rejects.toThrow(RangeError);
    const image = await instance.getImage({ vehicle: "veh_395yw8tn73ff8" });
    expect(image).toMatchObject({ creditsCharged: 0, creditsRemaining: null, usage: { vehicleImages: { used: 5, included: 100 } } });
  });

  it("renders by vehicle id and with hex paint, and looks a vehicle id up without a key", async () => {
    const { instance, calls } = client([
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } }),
      Response.json({ data: { id: "veh_395yw8tn73ff8", make: { id: 1, name: "Porsche", slug: "porsche" }, model: { name: "911", slug: "911", vehicle_type: "Passenger Car" }, year: 2024, years: [2024], year_ranges: [], image_path: "/api/v1/images/car?vehicle=veh_395yw8tn73ff8", images: {} }, request_id: "r" }),
    ]);
    await instance.getImage({ vehicle: "veh_395yw8tn73ff8", color: "#1A2B3C", view: "side" });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/images/car?vehicle=veh_395yw8tn73ff8&view=side&color=1a2b3c");
    const vehicle = await instance.vehicle("veh_395yw8tn73ff8");
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/vehicles/veh_395yw8tn73ff8");
    expect(vehicle.data.make.slug).toBe("porsche");
    await expect(instance.vehicle(" ")).rejects.toThrow(/vehicle id/);

    const { fetchImpl, calls: anonymousCalls } = mockFetch([Response.json({ data: {}, request_id: "r" })]);
    const anonymous = new CarImageClient({ apiKey: "", baseUrl: "https://api.example.test", fetch: fetchImpl, sleep });
    if (!anonymous.hasApiKey) {
      await anonymous.vehicle("veh_395yw8tn73ff8");
      expect(anonymousCalls[0]?.headers.has("authorization")).toBe(false);
    }
  });

  it("decodes a VIN with an optional year hint, keeping the * of a partial VIN", async () => {
    const { instance, calls } = client([Response.json({ data: { vin: "1HGCM82633A004352", vehicle: null }, request_id: "a" }), Response.json({ data: { vin: "1HGCM826*3A", vehicle: null }, request_id: "b" })]);
    await instance.decodeVin(" 1HGCM82633A004352 ", { year: "2003" });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/vin/1HGCM82633A004352?year=2003");
    expect(calls[0]?.headers.get("authorization")).toContain("Bearer");
    await instance.decodeVin("1HGCM826*3A");
    expect(calls[1]?.url).toBe("https://api.example.test/api/v1/vin/1HGCM826*3A");
    await expect(instance.decodeVin("")).rejects.toThrow(/vin is required/);
    const anonymous = new CarImageClient({ apiKey: "", baseUrl: "https://api.example.test", fetch: mockFetch([]).fetchImpl, sleep });
    if (!anonymous.hasApiKey) await expect(anonymous.decodeVin("1HGCM82633A004352")).rejects.toMatchObject({ status: 401 });
  });

  it("creates, reads and lists 3D models with an Idempotency-Key on the POST", async () => {
    const model = { id: "22222222-2222-4222-8222-222222222222", object: "3d_model", status: "processing", progress: 10, files: null };
    const { instance, calls } = client([
      Response.json({ data: model, billing: { charged_on: "creation", credits_charged: 1000, credits_remaining: 4000 }, request_id: "a" }, { status: 202 }),
      Response.json({ data: model, billing: { charged_on: "creation", credits_charged: 1000, credits_remaining: 3000 }, request_id: "b" }, { status: 202 }),
      Response.json({ data: model, request_id: "c" }),
      Response.json({ data: [model], pricing: { credits_per_model: 100 }, request_id: "d" }),
      Response.json({ data: { ...model, public: { id: "m3d_0123456789abcdef" } }, request_id: "e" }),
      Response.json({ data: { ...model, public: null }, request_id: "f" }),
    ]);
    const created = await instance.create3dModel({ make: " Toyota ", model: "Camry", year: "2025" }, { color: "#1a2b3c", webhookUrl: "https://hooks.example.com/x", webhookSecret: "s3cret", publish: true });
    expect(created.billing.credits_charged).toBe(1000);
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/3d");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ make: "Toyota", model: "Camry", year: 2025, color: "#1a2b3c", webhook_url: "https://hooks.example.com/x", webhook_secret: "s3cret", publish: true });
    expect(calls[0]?.headers.get("idempotency-key")).toMatch(/^sdk_[0-9a-f-]{36}$/);
    await instance.create3dModel({ vehicle: "veh_395yw8tn73ff8" }, { idempotencyKey: "model-42" });
    expect(calls[1]?.body).toEqual({ vehicle: "veh_395yw8tn73ff8" });
    expect(calls[1]?.headers.get("idempotency-key")).toBe("model-42");
    await instance.get3dModel(model.id);
    expect(calls[2]?.url).toBe(`https://api.example.test/api/v1/3d/${model.id}`);
    const list = await instance.list3dModels({ limit: 5 });
    expect(calls[3]?.url).toBe("https://api.example.test/api/v1/3d?limit=5");
    expect(list.pricing.credits_per_model).toBe(100);
    const published = await instance.publish3dModel(model.id);
    expect(calls[4]).toMatchObject({ url: `https://api.example.test/api/v1/3d/${model.id}/publish` });
    expect(calls[4]?.init.method).toBe("POST");
    expect(published.data.public?.id).toBe("m3d_0123456789abcdef");
    const unpublished = await instance.unpublish3dModel(model.id);
    expect(calls[5]?.init.method).toBe("DELETE");
    expect(unpublished.data.public).toBeNull();
    await expect(instance.create3dModel({ make: "Toyota", model: "Camry", year: 2025 }, { color: "navyish" })).rejects.toThrow(/Invalid color/);
    await expect(instance.create3dModel({ make: "Toyota", model: "" } as never)).rejects.toThrow(/model is required/);
    await expect(instance.get3dModel(" ")).rejects.toThrow(/request id/);
  });

  it("downloads a 3D file by following the signed redirect without the API key", async () => {
    const bytes = new Uint8Array([103, 108, 84, 70]);
    const { instance, calls } = client([
      new Response(null, { status: 302, headers: { Location: "https://storage.example.net/models/x.glb?token=abc", "X-Request-Id": "req_file", "X-File-Content-Type": "model/gltf-binary" } }),
      new Response(bytes, { status: 200, headers: { "Content-Type": "model/gltf-binary" } }),
    ]);
    const file = await instance.download3dModel("22222222-2222-4222-8222-222222222222", "glb");
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/3d/22222222-2222-4222-8222-222222222222/files/glb");
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[0]?.headers.get("authorization")).toContain("Bearer");
    expect(calls[1]?.url).toBe("https://storage.example.net/models/x.glb?token=abc");
    expect(calls[1]?.headers.has("authorization")).toBe(false);
    expect(file).toMatchObject({ kind: "glb", contentType: "model/gltf-binary", requestId: "req_file" });
    expect(file.bytes).toEqual(bytes);

    // Not ready yet: the route's 409 surfaces as a CarImageError, never as a redirect.
    const { instance: early } = client([problem(409, "3D model not ready", "The model is processing", { status: "processing" }, { "Retry-After": "15" })]);
    await expect(early.download3dModel("22222222-2222-4222-8222-222222222222", "glb")).rejects.toMatchObject({ status: 409, retryAfterSeconds: 15 });
    // A storage failure names the file, not a bare status.
    const { instance: broken } = client([new Response(null, { status: 302, headers: { Location: "https://storage.example.net/gone" } }), new Response("expired", { status: 403 })]);
    await expect(broken.download3dModel("22222222-2222-4222-8222-222222222222", "usdz")).rejects.toMatchObject({ status: 403, title: "3D file download failed" });
    await expect(instance.download3dModel("22222222-2222-4222-8222-222222222222", "obj" as never)).rejects.toThrow(RangeError);
  });

  it("waits for a 3D model by polling until it settles, and times out with a 408", async () => {
    sleep.mockClear();
    const at = (status: string, progress: number) => Response.json({ data: { id: "m", object: "3d_model", status, progress, files: null }, request_id: "r" });
    const { instance, fetchImpl } = client([at("queued", 0), at("processing", 40), at("ready", 100)]);
    const seen: number[] = [];
    const model = await instance.wait3dModel("m", { intervalMs: 1000, onProgress: (state) => seen.push(state.progress) });
    expect(model.status).toBe("ready");
    expect(seen).toEqual([0, 40, 100]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(1000);

    const { instance: failing } = client([at("failed", 30)]);
    expect((await failing.wait3dModel("m")).status).toBe("failed");

    const { instance: slow } = client([at("processing", 50)]);
    await expect(slow.wait3dModel("m", { timeoutMs: 0 })).rejects.toMatchObject({ status: 408, title: "Timed out waiting for the 3D model" });
  });
});

it("getMakeLogo sends only make and transforms and reads billing metadata", async () => {
  const { instance, calls } = client([new Response(new Uint8Array([1, 2]), { headers: {
    "Content-Type": "image/png", "X-Credits-Charged": "1", "X-Credits-Remaining": "42", "X-Image-Source": "generated",
  } })]);
  const result = await instance.getMakeLogo({ make: "Toyota", width: 256, height: 128, trim: true, padding: 5, background: "#fff" });
  const url = new URL(calls[0].url);
  expect(url.pathname).toBe("/api/v1/images/logo");
  expect(Object.fromEntries(url.searchParams)).toEqual({ make: "Toyota", w: "256", h: "128", trim: "1", padding: "5", background: "#fff" });
  expect(calls[0].headers.get("authorization")).toContain("Bearer ");
  expect(result).toMatchObject({ creditsCharged: 1, creditsRemaining: 42, source: "generated", vehicleId: null });
  expect(result.bytes).toEqual(new Uint8Array([1, 2]));
});


it("waits through a cold 20-minute 3D generation with the default timeout", async () => {
  const now = vi.spyOn(Date, "now");
  let elapsed = 0;
  now.mockImplementation(() => elapsed);
  const instance = new CarImageClient({ apiKey: "cimg_test", baseUrl: "https://api.test", fetch: async () => {
    return Response.json({ data: { id: "m", status: elapsed >= 1_200_000 ? "ready" : "processing", progress: 50 }, request_id: "r" });
  }, sleep: async (ms) => { elapsed += ms; } });
  try {
    expect((await instance.wait3dModel("m", { intervalMs: 60_000 })).status).toBe("ready");
    expect(elapsed).toBe(1_200_000);
  } finally { now.mockRestore(); }
});

describe("feedback", () => {
  it("reportIssue attaches the last failed call when no request id is given", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const answers = [
      () => new Response(JSON.stringify({ title: "Upstream failed", detail: "timeout", status: 502, code: "upstream_timeout" }), { status: 502, headers: { "content-type": "application/problem+json", "x-request-id": "req_9" } }),
      () => Response.json({ created: true, data: { id: "i1" }, similar: [], request_id: "r" }, { status: 201 }),
    ];
    const client = new CarImageClient({
      apiKey: "cimg_test",
      baseUrl: "https://api.test",
      maxRetries: 0,
      fetch: async (input, init) => {
        seen.push({ url: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
        return answers.shift()!();
      },
    });
    await expect(client.vehicle("veh_395yw8tn73ff8")).rejects.toThrow(/Upstream failed/);
    expect(client.lastFailure).toMatchObject({ request_id: "req_9", endpoint: "/api/v1/vehicles/veh_395yw8tn73ff8", status: 502, error_code: "upstream_timeout" });
    const filed = await client.reportIssue({ title: "Vehicle lookup 502" });
    expect(filed.created).toBe(true);
    expect(seen[1]).toMatchObject({
      url: "https://api.test/api/v1/feedback/issues",
      body: { title: "Vehicle lookup 502", context: { request_id: "req_9", endpoint: "/api/v1/vehicles/veh_395yw8tn73ff8", status: 502, error_code: "upstream_timeout", client: "car-image-sdk" } },
    });
  });

  it("requestFeature and submitReview send what the API reads", async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    const client = new CarImageClient({
      apiKey: "cimg_test",
      baseUrl: "https://api.test",
      fetch: async (input, init) => {
        seen.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
        return Response.json({ created: false, data: null, similar: [], request_id: "r" });
      },
    });
    await client.requestFeature({ title: " Interior views ", force: true });
    await client.submitReview({ rating: 4, body: "Good" });
    await expect(client.submitReview({ rating: 0 })).rejects.toThrow(/rating/);
    expect(seen).toEqual([
      { url: "https://api.test/api/v1/feedback/features", method: "POST", body: { title: "Interior views", force: true } },
      { url: "https://api.test/api/v1/reviews/me", method: "PUT", body: { rating: 4, body: "Good" } },
    ]);
  });
});

describe("the market of sale", () => {
  const image = (headers: Record<string, string> = {}) =>
    new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/png", "X-Credits-Charged": "0", "X-Image-Source": "cache", ...headers } });

  it("getImage sends market and reads which appearance was served", async () => {
    const { instance, calls } = client([image({ "X-Vehicle-Appearance": "default; market=AU" }), image({ "X-Vehicle-Appearance": "default" }), image(), image({ "X-Vehicle-Appearance": "something else" })]);
    const marketed = await instance.getImage({ vehicle: "veh_395yw8tn73ff8", market: "au" });
    expect(new URL(calls[0].url).searchParams.get("market")).toBe("AU");
    expect(marketed.appearance).toEqual({ market: "AU", scope: "default" });
    const plain = await instance.getImage({ vehicle: "veh_395yw8tn73ff8" });
    expect(new URL(calls[1].url).searchParams.has("market")).toBe(false);
    expect(plain.appearance).toEqual({ market: null, scope: "default" });
    // A server from before the header, and a value this SDK does not know, read as null.
    expect((await instance.getImage({ vehicle: "veh_395yw8tn73ff8" })).appearance).toBeNull();
    expect((await instance.getImage({ vehicle: "veh_395yw8tn73ff8" })).appearance).toBeNull();
  });

  it("keeps the market out of the keyless URL of an image, which names the image alone", () => {
    const { instance } = client([]);
    const url = new URL(instance.cachedImageUrl({ vehicle: "veh_395yw8tn73ff8", view: "side", market: "AU" }));
    expect(url.searchParams.has("market")).toBe(false);
    expect(url.toString()).toBe(instance.cachedImageUrl({ vehicle: "veh_395yw8tn73ff8", view: "side" }));
  });

  it("createImageUrls and checkAvailability send the list's market beside the images, and each image's own", async () => {
    const minted = { data: [], billing: { charged_on: "creation", credits_charged: 0 }, request_id: "r" };
    const checked = { data: { object: "image_availability_check", images: [], summary: { items: 0, prepared: 0, not_prepared: 0 }, allowance: null }, request_id: "r" };
    const { instance, calls } = client([Response.json(minted, { status: 201 }), Response.json(checked), Response.json(minted, { status: 201 })]);
    await instance.createImageUrls([{ vehicle: "veh_395yw8tn73ff8", market: "gb" }, { vehicle: "veh_395yw8tn73ff8" }], { market: "au" });
    expect(calls[0].body).toMatchObject({ market: "AU", images: [{ vehicle: "veh_395yw8tn73ff8", market: "GB" }, { vehicle: "veh_395yw8tn73ff8" }] });
    await instance.checkAvailability([{ vehicle: "veh_395yw8tn73ff8" }], { market: "nz" });
    expect(calls[1].body).toEqual({ images: [{ vehicle: "veh_395yw8tn73ff8" }], market: "NZ" });
    await instance.createImageUrls({ vehicle: "veh_395yw8tn73ff8" });
    expect(calls[2].body).not.toHaveProperty("market");
    await expect(instance.createImageUrls({ vehicle: "veh_395yw8tn73ff8" }, { market: "australia" })).rejects.toThrow(TypeError);
  });

  it("resolve, getImageAvailability, checkVehicles and a vehicle request carry it too", async () => {
    const resolved = { data: { params: { vehicle_id: null, make: "ford", model: "ranger", year: 2022, view: "front-3-4", color: "silver" }, candidates: [], confidence: "high", appearance: { market: "AU", scope: "default" } }, request_id: "r" };
    const check = { data: { appearance: { market: "AU", scope: "default" }, summary: { total: 1, match: 0, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 0 }, results: [{ index: 0, status: "miss", vehicle: null }] }, request_id: "r" };
    const { instance, calls } = client([
      Response.json(resolved), Response.json({ data: {}, request_id: "r" }), Response.json(check), Response.json(check), Response.json({ data: {}, deduplicated: false, request_id: "r" }, { status: 201 }),
    ]);
    const answer = await instance.resolve("2022 ford ranger", { market: "au" });
    expect(calls[0].body).toEqual({ query: "2022 ford ranger", market: "AU" });
    expect(answer.data.appearance).toEqual({ market: "AU", scope: "default" });
    await instance.getImageAvailability({ vehicle: "veh_395yw8tn73ff8", market: "AU" });
    expect(new URL(calls[1].url).searchParams.get("market")).toBe("AU");
    const first = await instance.checkVehicles([{ make: "Ford", model: "Ranger", year: 2022 }], { market: "au" });
    expect(calls[2].body).toEqual({ vehicles: [{ make: "Ford", model: "Ranger", year: 2022 }], market: "AU" });
    expect(first.data.appearance).toEqual({ market: "AU", scope: "default" });
    await instance.checkVehicles([{ make: "Ford", model: "Ranger", year: 2022 }]);
    expect(calls[3].body).toEqual({ vehicles: [{ make: "Ford", model: "Ranger", year: 2022 }] });
    await instance.createRequest({ kind: "vehicle", make: "Ford", model: "Ranger", year: 2022, market: "au" });
    expect(calls[4].body).toEqual({ kind: "vehicle", make: "Ford", model: "Ranger", year: 2022, market: "AU" });
  });
});
