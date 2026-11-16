import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model3d } from "@meterapp/car-image-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";
import { modelFileStem, progressLine, renderModel } from "./model3d.js";

let dir: string;
let out: string[];
let err: string[];

const ID = "22222222-2222-4222-8222-222222222222";

const PROCESSING: Model3d = {
  id: ID,
  object: "3d_model",
  status: "processing",
  progress: 40,
  stage: "geometry",
  vehicle: { id: "veh_errc87t1jgata", make: "toyota", model: "camry", year: 2025 },
  color: "#1a2b3c",
  generator: "meshy-7",
  files: null,
  polycount: null,
  error: null,
  estimated_seconds_remaining: 120,
  webhook: null,
  public: null,
  created_at: "2026-09-16T02:12:00.000Z",
  updated_at: "2026-09-16T02:13:00.000Z",
  ready_at: null,
};

const READY: Model3d = {
  ...PROCESSING,
  status: "ready",
  progress: 100,
  stage: "done",
  files: {
    glb: { url: `https://api.test/api/v1/3d/${ID}/files/glb`, bytes: 4, content_type: "model/gltf-binary" },
    thumbnail: { url: `https://api.test/api/v1/3d/${ID}/files/thumbnail`, bytes: 4, content_type: "image/png" },
  },
  polycount: 60000,
  estimated_seconds_remaining: null,
  ready_at: "2026-09-16T02:16:05.000Z",
};

const GLB = new Uint8Array([103, 108, 84, 70]);
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

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  idempotencyKey: string | null;
  redirect: RequestInit["redirect"];
  body: unknown;
}

function mockFetch(responses: Array<() => Response>) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      idempotencyKey: headers.get("idempotency-key"),
      redirect: init?.redirect,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}

function run(argv: string[], fetchImpl?: typeof fetch) {
  return main(argv, { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true });
}

const redirect = (target: string) => () => new Response(null, { status: 302, headers: { Location: target, "X-Request-Id": "req_file" } });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-3d-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("3d rendering helpers", () => {
  it("names files after the vehicle and paint and summarizes progress", () => {
    expect(modelFileStem(READY)).toBe("2025-toyota-camry-1a2b3c");
    expect(modelFileStem({ ...READY, color: "red", vehicle: { ...READY.vehicle, make: "Alfa Romeo", model: "Giulia" } })).toBe("2025-alfa-romeo-giulia-red");
    expect(progressLine(PROCESSING)).toBe("processing 40% (geometry) · ~120 s left");
    expect(progressLine(READY)).toBe("ready");
    const text = renderModel({ color: false }, READY);
    expect(text).toMatch(/status\s+ready/);
    expect(text).toMatch(/glb\s+0\.0 MB\s+model\/gltf-binary\s+https:\/\/api\.test\/api\/v1\/3d/);
    expect(text).toContain("60,000");
    expect(renderModel({ color: false }, { ...PROCESSING, status: "failed", error: { code: "provider_failed", message: "boom" } })).toContain("provider_failed: boom (credits refunded)");
    const pending = renderModel(
      { color: false },
      { ...PROCESSING, status: "failed", error: { code: "provider_failed", message: "boom", refunded: false, credits_refunded: 0, refunded_at: null, retryable: true, retry: "The refund of the 100 credits charged for this order is pending and has not been posted yet; to try again, send POST /api/v1/3d with a new Idempotency-Key (or none)." } }
    );
    expect(pending).toContain("provider_failed: boom (refund pending)");
    expect(pending).toMatch(/retry\s+The refund of the 100 credits charged for this order is pending/);
    const failedError = { code: "provider_failed", message: "boom", retryable: true as const };
    expect(renderModel({ color: false }, { ...PROCESSING, status: "failed", error: { ...failedError, refunded: true, credits_refunded: 100, refunded_at: "2026-11-15T22:21:44.612Z" } })).toContain("provider_failed: boom (credits refunded)");
    // An order the account already owned cost nothing: refunded is true with nothing given back.
    expect(renderModel({ color: false }, { ...PROCESSING, status: "failed", error: { ...failedError, refunded: true, credits_refunded: 0, refunded_at: null } })).toContain("provider_failed: boom (nothing charged)");
  });
});

describe("car-image 3d", () => {
  it("creates a model, waits for it and downloads every file into --out", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: PROCESSING, billing: { charged_on: "creation", credits_charged: 100, credits_remaining: 4000 }, request_id: "req_create" }, { status: 202 }),
      () => Response.json({ data: READY, request_id: "req_poll" }),
      redirect("https://storage.test/models/x.glb?token=1"),
      () => new Response(GLB, { headers: { "Content-Type": "model/gltf-binary" } }),
      redirect("https://storage.test/models/x.png?token=2"),
      () => new Response(PNG, { headers: { "Content-Type": "image/png" } }),
    ]);
    const models = join(dir, "models");
    expect(await run(["3d", "create", "--make", "Toyota", "--model", "Camry", "--year", "2025", "--color", "#1A2B3C", "--webhook-url", "https://hooks.test/x", "--out", models], fetchImpl)).toBe(0);
    expect(seen[0]).toMatchObject({ url: "https://api.test/api/v1/3d", method: "POST", body: { make: "Toyota", model: "Camry", year: 2025, color: "#1A2B3C", webhook_url: "https://hooks.test/x" } });
    expect(seen[0]?.idempotencyKey).toMatch(/^sdk_/);
    expect(seen[1]?.url).toBe(`https://api.test/api/v1/3d/${ID}`);
    // The signed storage URLs are followed by hand, without the key.
    expect(seen[2]).toMatchObject({ url: `https://api.test/api/v1/3d/${ID}/files/glb`, redirect: "manual" });
    expect(seen[2]?.auth).toContain("Bearer");
    expect(seen[3]).toMatchObject({ url: "https://storage.test/models/x.glb?token=1", auth: null });
    expect(new Uint8Array(await readFile(join(models, "2025-toyota-camry-1a2b3c.glb")))).toEqual(GLB);
    expect(new Uint8Array(await readFile(join(models, "2025-toyota-camry-1a2b3c.png")))).toEqual(PNG);
    const text = out.join("");
    expect(text).toContain(`Queued: 3D model ${ID} for 2025 toyota camry in #1a2b3c — charged 100 credits, 4,000 remaining`);
    expect(text).toContain("Saved");
    expect(text).toMatch(/status\s+ready/);
    expect(err.join("")).toContain("Waiting: ready");
  });

  it("prints the JSON of a created model without waiting, and points at the poll command", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: PROCESSING, billing: { charged_on: "creation", credits_charged: 100, credits_remaining: 4000 }, request_id: "req_create" }, { status: 202 }),
    ]);
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--idempotency-key", "model-7", "--json"], fetchImpl)).toBe(0);
    expect(seen[0]).toMatchObject({ body: { vehicle: "veh_errc87t1jgata" }, idempotencyKey: "model-7" });
    const parsed = JSON.parse(out.join("")) as { data: { status: string }; billing: { credits_charged: number } };
    expect(parsed.data.status).toBe("processing");
    expect(parsed.billing.credits_charged).toBe(100);
    out = [];
    const plain = mockFetch([
      () => Response.json({ data: PROCESSING, billing: { charged_on: "creation", credits_charged: 100, credits_remaining: 4000 }, request_id: "req_create" }, { status: 202 }),
    ]);
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata"], plain.fetchImpl)).toBe(0);
    expect(out.join("")).toContain(`car-image 3d get ${ID} --wait`);
  });

  it("reports a failed model with exit 1 and the refund", async () => {
    const failed: Model3d = { ...PROCESSING, status: "failed", progress: 30, error: { code: "provider_failed", message: "mesh generation failed" } };
    const { fetchImpl } = mockFetch([
      () => Response.json({ data: PROCESSING, billing: { charged_on: "creation", credits_charged: 100, credits_remaining: 4000 }, request_id: "req_create" }, { status: 202 }),
      () => Response.json({ data: failed, request_id: "req_poll" }),
    ]);
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--wait"], fetchImpl)).toBe(1);
    expect(err.join("")).toContain("mesh generation failed");
    expect(err.join("")).toContain("100 credits were refunded");
  });

  it("publishes at creation with --publish, then publishes and unpublishes by id", async () => {
    const PUBLIC = {
      id: "m3d_0123456789abcdef",
      url: "https://api.test/api/v1/3d/public/m3d_0123456789abcdef",
      files: null,
      embed: { script: "https://api.test/embed/3d.js", html: '<script src="https://api.test/embed/3d.js" async></script>\n<car-3d model="m3d_0123456789abcdef"></car-3d>' },
      published_at: "2026-09-16T02:12:01.000Z",
    };
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: { ...PROCESSING, public: PUBLIC }, billing: { charged_on: "creation", credits_charged: 0, credits_remaining: 4000, already_owned: true }, request_id: "req_create" }, { status: 202 }),
    ]);
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--publish"], fetchImpl)).toBe(0);
    expect(seen[0]?.body).toMatchObject({ vehicle: "veh_errc87t1jgata", publish: true });
    const created = out.join("");
    expect(created).toContain("already owned, nothing charged");
    expect(created).toContain('<car-3d model="m3d_0123456789abcdef"></car-3d>');
    expect(created).toContain("live once the model is ready");
    out = [];

    const hosted = {
      ...PUBLIC,
      files: {
        glb: { url: `${PUBLIC.url}/model.glb`, bytes: 1_500_000, content_type: "model/gltf-binary" },
        usdz: { url: `${PUBLIC.url}/model.usdz`, bytes: 16_000_000, content_type: "model/vnd.usdz+zip" },
        poster: { url: `${PUBLIC.url}/poster.png`, bytes: 80_000, content_type: "image/png" },
      },
    };
    const later = mockFetch([
      () => Response.json({ data: { ...READY, public: hosted }, request_id: "req_publish" }),
      () => Response.json({ data: { ...READY, public: null }, request_id: "req_unpublish" }),
    ]);
    expect(await run(["3d", "publish", ID], later.fetchImpl)).toBe(0);
    expect(later.seen[0]).toMatchObject({ url: `https://api.test/api/v1/3d/${ID}/publish`, method: "POST" });
    expect(out.join("")).toContain(`${PUBLIC.url}/model.glb`);
    expect(out.join("")).toContain("Published: 3D model");
    out = [];
    expect(await run(["3d", "publish", ID, "--unpublish"], later.fetchImpl)).toBe(0);
    expect(later.seen[1]).toMatchObject({ url: `https://api.test/api/v1/3d/${ID}/publish`, method: "DELETE" });
    expect(out.join("")).toContain("unpublished");
  });

  it("gets, lists and downloads", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: READY, request_id: "req_get" }),
      () => Response.json({ data: [READY, PROCESSING], pricing: { credits_per_model: 100 }, request_id: "req_list" }),
      () => Response.json({ data: READY, request_id: "req_get2" }),
      redirect("https://storage.test/models/x.glb?token=3"),
      () => new Response(GLB, { headers: { "Content-Type": "model/gltf-binary" } }),
    ]);
    expect(await run(["3d", "get", ID, "--json"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe(`https://api.test/api/v1/3d/${ID}`);
    expect((JSON.parse(out.join("")) as { data: { status: string } }).data.status).toBe("ready");
    out = [];
    expect(await run(["3d", "list", "--limit", "5"], fetchImpl)).toBe(0);
    expect(seen[1]?.url).toBe("https://api.test/api/v1/3d?limit=5");
    expect(out.join("")).toMatch(/id\s+status\s+vehicle\s+color\s+created/);
    expect(out.join("")).toContain("processing 40% (geometry)");
    expect(out.join("")).toContain("100 credits per model");
    out = [];
    const file = join(dir, "camry.glb");
    expect(await run(["3d", "download", ID, "--format", "glb", "--out", file], fetchImpl)).toBe(0);
    expect(new Uint8Array(await readFile(file))).toEqual(GLB);
    expect(out.join("")).toContain(`Saved ${file} (glb, 0.0 MB, model/gltf-binary)`);
  });

  it("refuses to download a model that is not ready, with the wait hint", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: PROCESSING, request_id: "req_get" })]);
    expect(await run(["3d", "download", ID], fetchImpl)).toBe(1);
    expect(err.join("")).toContain("processing 40%");
    expect(err.join("")).toContain(`car-image 3d get ${ID} --wait`);
    await expect(stat(join(dir, "2025-toyota-camry-1a2b3c.glb"))).rejects.toThrow();
  });

  it("returns usage errors for a missing action, a missing vehicle, both selectors, a bad color and an orphan secret", async () => {
    expect(await run(["3d"])).toBe(2);
    expect(err.join("")).toContain("Missing 3d action");
    err = [];
    expect(await run(["3d", "frob"])).toBe(2);
    err = [];
    expect(await run(["3d", "create", "--make", "Toyota"])).toBe(2);
    expect(err.join("")).toContain("Missing required option --model");
    err = [];
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--make", "Toyota"])).toBe(2);
    expect(err.join("")).toContain("not both");
    err = [];
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--color", "navyish"])).toBe(2);
    expect(err.join("")).toContain("hex paint such as #1a2b3c");
    err = [];
    expect(await run(["3d", "create", "--vehicle", "veh_errc87t1jgata", "--webhook-secret", "x"])).toBe(2);
    expect(err.join("")).toContain("--webhook-secret needs --webhook-url");
    err = [];
    expect(await run(["3d", "get"])).toBe(2);
    expect(err.join("")).toContain("Missing 3D model id");
  });

  it("asks the user to log in when no key is configured", async () => {
    const code = await main(["3d", "list"], { env: { ...env(), CAR_IMAGE_API_KEY: "" }, io: io(), skipUpdateCheck: true });
    expect(code).toBe(1);
    expect(err.join("")).toContain("Not signed in");
  });
});
