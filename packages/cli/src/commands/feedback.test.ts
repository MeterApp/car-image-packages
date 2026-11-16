import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";

let dir: string;
let out: string[];
let err: string[];

const RECORD = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "feature",
  title: "Interior views",
  body: null,
  vehicle: null,
  status: "open",
  visibility: "public",
  votes: 4,
  comments: 0,
  author: "Ada",
  url: "https://api.test/requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
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
  dir = await mkdtemp(join(tmpdir(), "car-image-feedback-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("car-image feedback", () => {
  it("remembers a failed call and attaches it with report --last", async () => {
    const problem = () =>
      new Response(JSON.stringify({ title: "Upstream failed", detail: "render timed out", status: 502, request_id: "req_502", code: "upstream_timeout" }), {
        status: 502,
        headers: { "content-type": "application/problem+json", "x-request-id": "req_502" },
      });
    const failing = mockFetch([problem, problem, problem]);
    expect(await run(["get", "--vehicle", "veh_395yw8tn73ff8", "--out", join(dir, "car.png")], failing.fetchImpl)).toBe(1);
    expect(err.join("")).toContain("car-image feedback report");
    const remembered = JSON.parse(await readFile(join(dir, "last-error.json"), "utf8"));
    expect(remembered).toMatchObject({ request_id: "req_502", command: "get", status: 502 });

    const filing = mockFetch([() => Response.json({ created: true, data: { ...RECORD, kind: "issue", title: "Side view 502", visibility: "private" }, similar: [], request_id: "r" }, { status: 201 })]);
    expect(await run(["feedback", "report", "Side view 502", "--last"], filing.fetchImpl)).toBe(0);
    expect(filing.seen[0]).toMatchObject({ url: "https://api.test/api/v1/feedback/issues", method: "POST" });
    expect(filing.seen[0].body).toMatchObject({ title: "Side view 502", context: { request_id: "req_502", endpoint: "car-image get", status: 502, client: "car-image-cli" } });
    expect(out.join("")).toContain("Reported (private to you and the team)");
  });

  it("shows the similar items instead of filing, then files with --force", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ created: false, data: null, similar: [RECORD], request_id: "a" }),
      () => Response.json({ created: true, data: RECORD, similar: [RECORD], request_id: "b" }, { status: 201 }),
    ]);
    expect(await run(["feedback", "request", "Interior", "shots"], fetchImpl)).toBe(0);
    expect(out.join("")).toContain("Not filed: 1 similar item(s)");
    expect(await run(["feedback", "request", "Interior shots", "--force"], fetchImpl)).toBe(0);
    expect(seen.map((call) => call.body)).toEqual([{ title: "Interior shots" }, { title: "Interior shots", force: true }]);
  });

  it("lists, upvotes and removes a vote, and still rates an image with --rating", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: [RECORD], next_cursor: null, request_id: "a" }),
      () => Response.json({ data: { ...RECORD, votes: 5 }, request_id: "b" }),
      () => Response.json({ data: RECORD, request_id: "c" }),
      () => Response.json({ data: { asset_id: "x", recorded: true, flagged: false }, request_id: "d" }, { status: 201 }),
    ]);
    expect(await run(["feedback", "mine"], fetchImpl)).toBe(0);
    expect(await run(["feedback", "upvote", RECORD.id], fetchImpl)).toBe(0);
    expect(await run(["feedback", "upvote", RECORD.id, "--remove"], fetchImpl)).toBe(0);
    expect(await run(["feedback", "--request-id", "req_1", "--rating", "5"], fetchImpl)).toBe(0);
    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://api.test/api/v1/feedback?sort=recent_activity&mine=true",
      `POST https://api.test/api/v1/feedback/${RECORD.id}/votes`,
      `DELETE https://api.test/api/v1/feedback/${RECORD.id}/votes`,
      "POST https://api.test/api/v1/feedback",
    ]);
  });
});

describe("car-image review and reviews", () => {
  it("posts a review and reads the public ones", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: { id: "r", rating: 5, title: null, body: "Great", display_name: "Ada", status: "published", marketing_consent: true, response: null, created_at: "t" }, created: true, request_id: "a" }, { status: 201 }),
      () => Response.json({ data: [{ id: "r", rating: 5, title: "Great", body: null, display_name: "Ada", created_at: "2026-10-17T00:00:00Z", response: { body: "Thanks!", responded_at: "t" } }], summary: { count: 1, average: 5, distribution: { "5": 1 } }, next_cursor: null, request_id: "b" }),
    ]);
    expect(await run(["review", "--rating", "5", "--body", "Great", "--quote-ok"], fetchImpl)).toBe(0);
    expect(seen[0]).toMatchObject({ method: "PUT", url: "https://api.test/api/v1/reviews/me", body: { rating: 5, body: "Great", marketing_consent: true } });
    expect(await run(["reviews"], fetchImpl)).toBe(0);
    expect(out.join("")).toContain("1 review(s), average 5 of 5.");
    expect(out.join("")).toContain("Car Image: Thanks!");
  });
});
