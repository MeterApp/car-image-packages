import { describe, expect, it } from "vitest";
import { doctorSummary, renderDoctorTable, runDoctor, type DoctorDeps } from "./doctor.js";

const BASE = "https://api.test";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Request-Id": "req_x", ...headers } });
}

function image(headers: Record<string, string> = {}, method = "GET"): Response {
  return new Response(method === "HEAD" ? null : new Uint8Array(2048), { status: 200, headers: { "Content-Type": "image/png", "X-Image-Source": "cache", ...headers } });
}

/** What production lists since the top view (2026-11): nine, where the check once demanded exactly six. */
const PRODUCTION_VIEWS = ["front", "front-3-4", "side", "rear-3-4", "rear", "rear-3-4-right", "side-right", "front-3-4-right", "top"];

function fakeApi(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const calls: string[] = [];
  const routes: Record<string, (init?: RequestInit) => Response> = {
    "GET /api/health": () => json({ status: "ok", checks: {} }),
    "GET /api/v1/images/options": () => json({ data: { views: PRODUCTION_VIEWS.map((id) => ({ id })), colors: Array.from({ length: 15 }, (_, i) => ({ name: String(i) })) } }),
    "GET /api/v1/vehicles": () => json({ data: { years: Array.from({ length: 37 }, (_, i) => 1990 + i) } }),
    "GET /api/v1/vehicles?year=2024": () => json({ data: { year: 2024, makes: [{ id: 3, name: "Audi" }, { id: 7, name: "Porsche" }] } }),
    "GET /api/v1/vehicles?year=2024&makeId=7": () => json({ data: { year: 2024, make_id: 7, models: [{ id: 1, name: "911" }] } }),
    "GET /api/v1/vehicles?q=porsche%20911&limit=5": () => json({ data: { results: [{ kind: "model", makeName: "Porsche", modelName: "911", years: [2024], matchKind: "exact" }] } }),
    "POST /api/v1/images/resolve": () => json({ data: { params: { make: "porsche", model: "911", year: 2024, view: "side", color: "red" }, candidates: [], confidence: "high" } }),
    "GET /api/v1/account": () => json({ data: { credits: 100 } }),
    "POST /api/v1/image-urls": () => json({ data: [{ id: "u1", url: `${BASE}/api/v1/delivery/tok`, expires_at: "2026-01-01T00:00:00Z", max_uses: 0 }], billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 99 }, request_id: "req_urls" }, 201),
    "HEAD https://api.test/api/v1/delivery/tok": () => image({}, "HEAD"),
    "GET https://api.test/api/v1/delivery/tok": () => image(),
    "GET /api/v1/images/car?make=Porsche&model=911&year=2024&view=front-3-4&w=256": () => image({ "X-Image-Source": "generated", "X-Credits-Charged": "1", "X-Credits-Remaining": "98", "X-Request-Id": "req_img" }),
    "POST /api/v1/feedback": (init) => {
      calls.push(`feedback ${String(init?.body)}`);
      return json({ data: {}, request_id: "req_fb" }, 201);
    },
    ...overrides,
  };
  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.startsWith(BASE) && !url.includes("/delivery/") ? url.slice(BASE.length) : url;
    const key = `${method} ${path}`;
    calls.push(key);
    const route = routes[key];
    if (!route) return json({ title: "Not found", detail: `no fake route for ${key}` }, 404);
    return route(init);
  };
  const deps: DoctorDeps = {
    client: { fetch: (path, init) => handler(path.startsWith("http") ? path : `${BASE}${path}`, init) },
    publicFetch: (url, init) => handler(url, init),
    hasKey: true,
    now: (() => {
      let tick = 0;
      return () => (tick += 5);
    })(),
    includeImage: true,
  };
  return { deps, calls };
}

describe("runDoctor", () => {
  it("passes every check against a healthy API and records cost, cache and request ids", async () => {
    const { deps, calls } = fakeApi();
    const checks = await runDoctor(deps);
    expect(checks.map((check) => check.name)).toEqual([
      "health",
      "options",
      "vehicles:years",
      "vehicles:makes",
      "vehicles:models",
      "search",
      "resolve",
      "account",
      "image-urls",
      "delivery:head",
      "delivery:get",
      "image",
    ]);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
    expect(checks.find((check) => check.name === "image-urls")?.credits).toBe(1);
    expect(checks.find((check) => check.name === "image")).toMatchObject({ credits: 1, cache: "generated", requestId: "req_img" });
    expect(checks.find((check) => check.name === "delivery:get")?.cache).toBe("cache");
    expect(checks.every((check) => check.latencyMs === 5)).toBe(true);
    // The doctor never writes a rating: a synthetic "good" on every run would feed the quality loop noise.
    expect(calls.some((call) => call.startsWith("feedback "))).toBe(false);
    expect(doctorSummary(checks)).toEqual({ passed: 12, failed: 0, skipped: 0, ok: true });
  });

  // 2026-11-24: `car-image doctor` against production said "options FAIL  9 views, 15 colors" and
  // exited 1 for every user, because the check demanded exactly six views.
  it("passes options whatever the API's view count, and fails it only without the default view or any paint", async () => {
    const options = (views: string[], colors: number) => ({
      "GET /api/v1/images/options": () => json({ data: { views: views.map((id) => ({ id })), colors: Array.from({ length: colors }, (_, i) => ({ name: String(i) })) } }),
    });
    const check = async (views: string[], colors: number) => (await runDoctor(fakeApi(options(views, colors)).deps)).find((entry) => entry.name === "options");

    expect(await check(PRODUCTION_VIEWS, 15)).toMatchObject({ status: "pass", notes: "9 views, 15 colors" });
    expect(await check(PRODUCTION_VIEWS.slice(0, 6), 15)).toMatchObject({ status: "pass", notes: "6 views, 15 colors" });
    expect(await check([...PRODUCTION_VIEWS, "underside"], 16)).toMatchObject({ status: "pass" });
    expect(await check(["front", "rear"], 15)).toMatchObject({ status: "fail" });
    expect(await check(PRODUCTION_VIEWS, 0)).toMatchObject({ status: "fail" });
    expect(await check([], 15)).toMatchObject({ status: "fail" });
  });

  it("skips the keyed image when declined", async () => {
    const { deps, calls } = fakeApi();
    const checks = await runDoctor({ ...deps, includeImage: false });
    expect(checks.find((check) => check.name === "image")?.status).toBe("skip");
    expect(calls.some((call) => call.startsWith("feedback "))).toBe(false);
    expect(doctorSummary(checks).ok).toBe(true);
  });

  it("stops after the free checks in quick mode", async () => {
    const { deps, calls } = fakeApi();
    const checks = await runDoctor({ ...deps, quick: true });
    expect(checks.filter((check) => check.status === "skip").map((check) => check.name)).toEqual(["image-urls", "delivery:head", "delivery:get", "image"]);
    expect(calls.some((call) => call.includes("image-urls"))).toBe(false);
    expect(doctorSummary(checks).ok).toBe(true);
  });

  it("fails auth and skips keyed checks without a key", async () => {
    const { deps } = fakeApi();
    const checks = await runDoctor({ ...deps, hasKey: false });
    const auth = checks.find((check) => check.name === "auth");
    expect(auth?.status).toBe("fail");
    expect(auth?.hint).toContain("car-image login");
    expect(checks.filter((check) => check.status === "skip").length).toBe(6);
    expect(doctorSummary(checks).ok).toBe(false);
  });

  it("turns HTTP errors into failures with actionable hints", async () => {
    const { deps } = fakeApi({
      "GET /api/v1/account": () => json({ title: "Invalid API key", detail: "The API key is invalid or has been revoked.", status: 401 }, 401),
      "POST /api/v1/image-urls": () => json({ title: "Insufficient credits", detail: "balance is 0", status: 402 }, 402),
    });
    const checks = await runDoctor({ ...deps, includeImage: false });
    const account = checks.find((check) => check.name === "account");
    expect(account).toMatchObject({ status: "fail", httpStatus: 401 });
    expect(account?.notes).toContain("HTTP 401: The API key is invalid");
    expect(account?.hint).toContain("car-image login");
    expect(checks.find((check) => check.name === "image-urls")?.hint).toContain("car-image upgrade --plan");
    expect(checks.find((check) => check.name === "delivery:get")?.status).toBe("skip");
    expect(doctorSummary(checks).ok).toBe(false);
    const table = renderDoctorTable(checks, { color: false });
    expect(table).toContain("check");
    expect(table).toContain("latency");
    expect(table).toContain("FAIL");
    expect(table).toContain("Fixes:");
    expect(table).toContain("account: Run `car-image login`");
  });

  it("treats HEAD 405 on delivery as a skip rather than a failure", async () => {
    const { deps } = fakeApi({ "HEAD https://api.test/api/v1/delivery/tok": () => new Response(null, { status: 405 }) });
    const checks = await runDoctor({ ...deps, includeImage: false });
    expect(checks.find((check) => check.name === "delivery:head")?.status).toBe("skip");
    expect(doctorSummary(checks).ok).toBe(true);
  });

  it("reports network failures", async () => {
    const { deps } = fakeApi();
    const checks = await runDoctor({
      ...deps,
      client: {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    expect(checks[0]).toMatchObject({ name: "health", status: "fail", notes: "fetch failed" });
  });
});
