import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";

let dir: string;
let out: string[];
let err: string[];

const ENDPOINT = {
  id: "whe_0123456789abcdef0123456789abcdef",
  object: "webhook_endpoint",
  url: "https://example.com/hooks/carimage",
  events: ["*"],
  description: null,
  status: "active",
  disabled_reason: null,
  secret_prefix: "whsec_ab12",
  consecutive_failures: 0,
  failing_since: null,
  last_success_at: null,
  created_at: "2026-10-22T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z",
};

function env(): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", NO_COLOR: "1", CAR_IMAGE_API_KEY: "cimg_test" };
}

const io = () => ({ stdout: (text: string) => void out.push(text), stderr: (text: string) => void err.push(text), isTTY: false, stdinTTY: false, color: false });

function mockFetch(responses: Array<() => Response>) {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}

const run = (argv: string[], fetchImpl: typeof fetch) => main(argv, { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-webhooks-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("car-image webhooks", () => {
  it("adds an endpoint with its events and prints the secret once", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: { ...ENDPOINT, events: ["image.ready", "3d_model.ready"], secret: "whsec_ab12secret" }, entitlement: { plan: "pro", receives: "all" }, request_id: "r" }, { status: 201 }),
    ]);
    expect(await run(["webhooks", "add", "https://example.com/hooks/carimage", "--events", "image.ready,3d_model.ready"], fetchImpl)).toBe(0);
    expect(seen[0]).toMatchObject({ url: "https://api.test/api/v1/webhooks", method: "POST", body: { url: "https://example.com/hooks/carimage", events: ["image.ready", "3d_model.ready"] } });
    expect(out.join("")).toContain("whsec_ab12secret");
  });

  it("refuses an unknown event type before calling the API", async () => {
    const { fetchImpl, seen } = mockFetch([]);
    expect(await run(["webhooks", "add", "https://example.com/hooks", "--events", "image.deleted"], fetchImpl)).toBe(2);
    expect(seen).toHaveLength(0);
    expect(err.join("")).toContain("Unknown event type");
  });

  it("lists, tests and turns off endpoints, and says when the plan receives test events only", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: [ENDPOINT], limit: 10, entitlement: { plan: "free", receives: ["webhook.test"] }, request_id: "a" }),
      () => Response.json({ data: { event_id: "evt_0123456789abcdef0123456789abcdef", type: "webhook.test", endpoint_id: ENDPOINT.id, status: "queued" }, request_id: "b" }, { status: 202 }),
      () => Response.json({ data: { ...ENDPOINT, status: "disabled", disabled_reason: "manual" }, request_id: "c" }),
    ]);
    expect(await run(["webhooks"], fetchImpl)).toBe(0);
    expect(await run(["webhooks", "test", ENDPOINT.id], fetchImpl)).toBe(0);
    expect(await run(["webhooks", "disable", ENDPOINT.id], fetchImpl)).toBe(0);
    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://api.test/api/v1/webhooks",
      `POST https://api.test/api/v1/webhooks/${ENDPOINT.id}/test`,
      `PATCH https://api.test/api/v1/webhooks/${ENDPOINT.id}`,
    ]);
    expect(seen[2].body).toEqual({ status: "disabled" });
    const text = out.join("");
    expect(text).toContain("webhook.test only");
    expect(text).toContain("Queued webhook.test");
  });
});
