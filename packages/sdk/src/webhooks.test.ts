import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CarImageClient } from "./client.js";
import { verifyWebhook, WebhookVerificationError } from "./webhooks.js";

const SECRET = "whsec_testsecret0123456789";
const BODY = JSON.stringify({ id: "evt_0123456789abcdef0123456789abcdef", type: "image.ready", created_at: "2026-10-22T10:00:00.000Z", data: { view: "front" } });
const NOW = 1_790_000_000_000;

function header(body: string, secret: string, t: number): string {
  return `t=${t},sha256=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

describe("verifyWebhook", () => {
  it("returns the event when the signature over t.body matches", async () => {
    const event = await verifyWebhook(BODY, header(BODY, SECRET, NOW / 1000), SECRET, { now: NOW });
    expect(event.id).toBe("evt_0123456789abcdef0123456789abcdef");
    expect(event.type).toBe("image.ready");
  });

  it("refuses a missing or malformed header, another secret, a changed body and a stale timestamp", async () => {
    const good = header(BODY, SECRET, NOW / 1000);
    await expect(verifyWebhook(BODY, null, SECRET, { now: NOW })).rejects.toThrow(WebhookVerificationError);
    await expect(verifyWebhook(BODY, "sha256=abc", SECRET, { now: NOW })).rejects.toThrow(/Malformed/);
    await expect(verifyWebhook(BODY, good, "whsec_other", { now: NOW })).rejects.toThrow(/does not match/);
    await expect(verifyWebhook(`${BODY} `, good, SECRET, { now: NOW })).rejects.toThrow(/does not match/);
    await expect(verifyWebhook(BODY, good, SECRET, { now: NOW + 301_000 })).rejects.toThrow(/tolerance/);
    await expect(verifyWebhook(BODY, good, SECRET, { now: NOW + 301_000, toleranceSeconds: 600 })).resolves.toMatchObject({ type: "image.ready" });
  });
});

describe("webhook client methods", () => {
  it("call the documented paths with the documented methods", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return Response.json({ data: {}, request_id: "r" });
    });
    const client = new CarImageClient({ apiKey: "cimg_testkey_0123456789abcdef0123456789abc", baseUrl: "https://api.example.test", fetch: fetchImpl });
    const id = "whe_0123456789abcdef0123456789abcdef";
    await client.listWebhooks();
    await client.createWebhook({ url: "https://example.com/hook", events: ["image.ready"] });
    await client.getWebhook(id);
    await client.updateWebhook(id, { status: "disabled" });
    await client.deleteWebhook(id);
    await client.testWebhook(id);
    await client.listWebhookDeliveries(id, { limit: 5 });
    await client.listEvents({ type: "image.ready", since: new Date("2026-10-01T00:00:00Z"), limit: 10 });
    expect(calls.map((call) => `${call.method} ${call.url.replace("https://api.example.test", "")}`)).toEqual([
      "GET /api/v1/webhooks",
      "POST /api/v1/webhooks",
      `GET /api/v1/webhooks/${id}`,
      `PATCH /api/v1/webhooks/${id}`,
      `DELETE /api/v1/webhooks/${id}`,
      `POST /api/v1/webhooks/${id}/test`,
      `GET /api/v1/webhooks/${id}/deliveries?limit=5`,
      "GET /api/v1/events?type=image.ready&since=2026-10-01T00%3A00%3A00.000Z&limit=10",
    ]);
    expect(calls[1].body).toEqual({ url: "https://example.com/hook", events: ["image.ready"] });
    expect(calls[3].body).toEqual({ status: "disabled" });
  });
});
