import { expect, it } from "vitest";
import { CarImageClient } from "./client.js";
import { checkoutLinkSchema, helpQuerySchema } from "./mcp/support.js";
it("rejects ambiguous purchases, foreign accounts and invalid help questions", () => {
  for (const input of [{}, { credits: 100, plan: "pro" }, { credits: 123 }, { credits: 100, interval: "year" }, { plan: "free" }, { credits: 100, user_id: "victim" }]) expect(checkoutLinkSchema.safeParse(input).success).toBe(false);
  expect(checkoutLinkSchema.parse({ plan: "pro" })).toEqual({ plan: "pro" });
  expect(helpQuerySchema.safeParse({ query: "  " }).success).toBe(false);
  expect(helpQuerySchema.safeParse({ query: "x".repeat(1001) }).success).toBe(false);
});
it("routes SDK support and billing methods to the link-only API", async () => {
  const calls: { path: string; body: unknown; authorization: string | null }[] = [];
  const client = new CarImageClient({ apiKey: "cimg_test", baseUrl: "https://api.test", fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({ data: {}, request_id: "test" });
  } });
  await client.pricing(); await client.searchHelp("refund policy", { reportGap: true }); await client.createCheckoutLink({ plan: "pro" }); await client.getBillingLink();
  expect(calls.map((call) => call.path)).toEqual(["/api/v1/pricing", "/api/v1/help", "/api/v1/billing/link", "/api/v1/billing/link"]);
  expect(calls[0].authorization).toBeNull();
  expect(calls[1].body).toEqual({ query: "refund policy", report_gap: true });
  expect(calls[2].body).toEqual({ plan: "pro" }); expect(calls[3].body).toEqual({});
});
