import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";

let dir: string;
let out: string[];
let err: string[];

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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-billing-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("car-image billing", () => {
  it("refuses --credits without calling the API: credits are no longer sold", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input));
      throw new Error(`unexpected fetch ${String(input)}`);
    };
    for (const args of [["billing", "--credits", "500"], ["upgrade", "--credits", "123", "--json"]]) {
      expect(await main(args, { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(2);
    }
    expect(err.join("") + out.join("")).toContain("no longer sold");
    expect(err.join("") + out.join("")).toContain("--plan pro");
    expect(requested).toEqual([]);
  });

  it("opens billing settings when signed in and no plan is named", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
      return Response.json({ data: { url: "https://billing.stripe.com/p/session", kind: "portal", requires_confirmation: true, message: "Open this private Stripe portal link." }, request_id: "req" });
    };
    expect(await main(["billing", "--no-browser"], { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(0);
    expect(calls).toEqual([{ path: "/api/v1/billing/link", body: {} }]);
    expect(out.join("")).toContain("https://billing.stripe.com/p/session");
  });

  it("points a signed-out human at the plans when no plan is named, without calling the API", async () => {
    const fetchImpl: typeof fetch = async (input) => { throw new Error(`unexpected fetch ${String(input)}`); };
    expect(await main(["billing", "--no-browser"], { env: { ...env(), CAR_IMAGE_API_KEY: "" }, io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(0);
    expect(out.join("")).toContain("https://api.test/pricing?ref=cli");
  });
});

it("uses link-only checkout and leaves existing-plan changes for the browser", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return Response.json({ data: { url: "https://carimage.dev/dashboard?ref=cli#billing", kind: "dashboard", requires_confirmation: true, message: "Review the change in your dashboard." }, request_id: "req" });
  };
  expect(await main(["billing", "--plan", "pro", "--yearly", "--no-browser"], { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(0);
  expect(calls).toEqual([{ path: "/api/v1/billing/link", body: { plan: "pro", interval: "year" } }]);
  expect(out.join("")).toContain("Review the change");
  expect(out.join("")).not.toContain("Switched");
});

it("rejects conflicting purchase arguments before network I/O", async () => {
  const fetchImpl: typeof fetch = async () => { throw new Error("Must not reach billing"); };
  expect(await main(["billing", "--plan", "pro", "--credits", "100"], { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(2);
});

it("forwards help gap reports even when the flag precedes the question", async () => {
  let sent: unknown;
  const fetchImpl: typeof fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ data: { status: "needs_support", articles: [], guidance: "Contact support", support: "support@carimage.dev", version: "test", query_recorded: true }, request_id: "req" });
  };
  expect(await main(["support", "--report-gap", "custom guarantee", "--json"], { env: env(), io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(0);
  expect(sent).toEqual({ query: "custom guarantee", report_gap: true });
});

it("prints the pricing document's checkout link before sign-in (upgrade alias), without a key", async () => {
    const requested: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requested.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      const plan = { id: "pro", name: "Pro", price: { monthly: 49, yearly: 490 }, checkout_url: "https://checkout.example.test/dashboard/checkout?plan=pro&interval=month&ref=agent-cli", checkout_url_yearly: "https://checkout.example.test/dashboard/checkout?plan=pro&interval=year&ref=agent-cli" };
      return Response.json({ data: { plans: [plan], add_ons: [] }, request_id: "req_1" });
    };
    const keyless = { ...env(), CAR_IMAGE_API_KEY: "" };
    expect(await main(["upgrade", "--plan", "pro", "--yearly", "--no-browser"], { env: keyless, io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(0);
    expect(out.join("")).toContain("$490.00 per year");
    expect(out.join("")).toContain("https://checkout.example.test/dashboard/checkout?plan=pro&interval=year&ref=agent-cli");
    expect(await main(["billing", "--credits", "500", "--no-browser", "--json"], { env: keyless, io: io(), fetch: fetchImpl, skipUpdateCheck: true })).toBe(2);
  expect(requested.every((request) => request.url.endsWith("/api/v1/pricing") && request.auth === null)).toBe(true);
});
