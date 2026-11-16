import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../main.js";
import { SAVED_MESSAGE } from "./about.js";
import { requestLabel, requestPageLink, votesLabel } from "./request.js";

let dir: string;
let out: string[];
let err: string[];

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

const RECORD = {
  id: "rq_sienna",
  kind: "vehicle",
  title: "Toyota Sienna (2024)",
  body: null,
  vehicle: { make: "Toyota", model: "Sienna", year: 2024 },
  status: "open",
  votes: 1,
  comments: 0,
  author: "Ada",
  url: "https://api.test/requests/rq_sienna",
  created_at: "2026-09-11T00:00:00Z",
  updated_at: "2026-09-11T00:00:00Z",
};

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { CAR_IMAGE_CONFIG: join(dir, "config.json"), CAR_IMAGE_TELEMETRY: "0", CAR_IMAGE_API_URL: "https://api.test", NO_COLOR: "1", ...extra };
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

/** Records every call and answers from the queue (or the fallback). */
function mockFetch(responses: Array<() => Response>, fallback?: () => Response) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    seen.push({ url: String(input), method: init?.method ?? "GET", auth: headers.get("authorization"), body });
    const next = responses.shift() ?? fallback;
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    return next();
  };
  return { fetchImpl, seen };
}

function run(argv: string[], fetchImpl?: typeof fetch, extraEnv: Record<string, string> = {}) {
  return main(argv, { env: env(extraEnv), io: io(), fetch: fetchImpl, skipUpdateCheck: true });
}

const KEY = { CAR_IMAGE_API_KEY: "cimg_test" };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-request-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("request labels", () => {
  it("names vehicle requests by make, model and year", () => {
    expect(requestLabel(RECORD as never)).toBe("Toyota Sienna (2024)");
    expect(requestLabel({ kind: "vehicle", title: "x", vehicle: { make: "Rivian", model: "R2", year: null } })).toBe("Rivian R2");
    expect(requestLabel({ kind: "feature", title: "Interior views", vehicle: null })).toBe("Interior views");
    expect(votesLabel(1)).toBe("1 vote");
    expect(votesLabel(12)).toBe("12 votes");
  });
});

/** The live origin, kept apart so the untagged pages the API returns are not themselves published links. */
const LIVE = "https://carimage.dev";

describe("requestPageLink", () => {
  it("tags a carimage.dev request page for the terminal", () => {
    expect(requestPageLink(`${LIVE}/requests/rq_1`)).toBe("https://carimage.dev/requests/rq_1?ref=cli");
    expect(requestPageLink(`${LIVE}/requests/rq_1?ref=llms`)).toBe("https://carimage.dev/requests/rq_1?ref=cli");
  });

  it("leaves other hosts and anything unparsable alone", () => {
    expect(requestPageLink("http://localhost:3000/requests/rq_1")).toBe("http://localhost:3000/requests/rq_1");
    expect(requestPageLink("not a url")).toBe("not a url");
  });
});

describe("car-image request", () => {
  it("lists the board without a key and prints a compact table", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: [RECORD, { ...RECORD, id: "rq_int", kind: "feature", title: "Interior views", vehicle: null, votes: 12, status: "planned" }], next_cursor: null, request_id: "r1" }),
    ]);
    expect(await run(["request", "list", "--kind", "vehicle", "--sort", "new", "--limit", "5"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/requests?kind=vehicle&sort=new&limit=5");
    expect(seen[0]?.auth).toBeNull();
    const text = out.join("");
    expect(text).toMatch(/votes\s+kind\s+title\s+id\s+status/);
    expect(text).toMatch(/1\s+vehicle\s+Toyota Sienna \(2024\)\s+rq_sienna\s+open/);
    expect(text).toMatch(/12\s+feature\s+Interior views\s+rq_int\s+planned/);
    expect(text).toContain("car-image request upvote <id>");
  });

  it("rejects an invalid --status with a usage error", async () => {
    expect(await run(["request", "list", "--status", "someday"])).toBe(2);
    expect(err.join("")).toContain("Invalid --status");
    expect(err.join("")).toContain("in_progress");
  });

  it("defaults to list and emits JSON with --json", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: [RECORD], next_cursor: "abc", request_id: "r1" })]);
    expect(await run(["requests", "--json"], fetchImpl)).toBe(0);
    const parsed = JSON.parse(out.join("")) as { data: Array<{ id: string }>; next_cursor: string };
    expect(parsed.data[0]?.id).toBe("rq_sienna");
    expect(parsed.next_cursor).toBe("abc");
  });

  it("files a vehicle request and prints the tracking line", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: RECORD, deduplicated: false, request_id: "r2" }, { status: 201 })]);
    expect(await run(["request", "vehicle", "Toyota", "Sienna", "--year", "2024", "--note", "hybrid trim"], fetchImpl, KEY)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/requests");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.auth).toBe("Bearer cimg_test");
    expect(seen[0]?.body).toEqual({ kind: "vehicle", make: "Toyota", model: "Sienna", year: 2024, body: "hybrid trim" });
    const text = out.join("");
    expect(text).toContain("Requested Toyota Sienna (2024) — 1 vote. Track it at https://api.test/requests/rq_sienna");
    expect(text).toContain("We email you when it is live.");
  });

  it("prints the public page with ?ref=cli when the API names carimage.dev", async () => {
    const live = { ...RECORD, url: `${LIVE}/requests/rq_sienna` };
    const { fetchImpl } = mockFetch([() => Response.json({ data: live, deduplicated: false, request_id: "r2" }, { status: 201 })]);
    expect(await run(["request", "vehicle", "Toyota", "Sienna"], fetchImpl, KEY)).toBe(0);
    expect(out.join("")).toContain("Track it at https://carimage.dev/requests/rq_sienna?ref=cli");
  });

  it("explains a deduplicated vehicle request", async () => {
    const { fetchImpl } = mockFetch([() => Response.json({ data: { ...RECORD, votes: 7 }, deduplicated: true, request_id: "r3" }, { status: 200 })]);
    expect(await run(["request", "vehicle", "Toyota", "Grand", "Highlander"], fetchImpl, KEY)).toBe(0);
    expect(out.join("")).toContain("Already requested — added your upvote (7 votes). Track it at https://api.test/requests/rq_sienna");
  });

  it("requires a key for creating, upvoting and commenting", async () => {
    expect(await run(["request", "vehicle", "Toyota", "Sienna"])).toBe(1);
    expect(await run(["request", "feature", "Interior views"])).toBe(1);
    expect(await run(["request", "upvote", "rq_sienna"])).toBe(1);
    expect(await run(["request", "comment", "rq_sienna", "please"])).toBe(1);
    expect(err.join("")).toContain("Not signed in");
    expect(err.join("")).toContain("car-image login");
  });

  it("returns usage errors for missing arguments and unknown actions", async () => {
    expect(await run(["request", "vehicle", "Toyota"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain("Provide the make and the model");
    err = [];
    expect(await run(["request", "feature"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain("Provide a title");
    err = [];
    expect(await run(["request", "show"])).toBe(2);
    expect(err.join("")).toContain("Missing request id");
    err = [];
    expect(await run(["request", "comment", "rq_sienna"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain("Provide the comment text");
    err = [];
    expect(await run(["request", "frobnicate"])).toBe(2);
    expect(err.join("")).toContain('Unknown request action "frobnicate"');
    expect(err.join("")).toContain("list, vehicle, feature, show, upvote, comment");
  });

  it("files a feature request with details", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: { ...RECORD, id: "rq_int", kind: "feature", title: "Interior views", vehicle: null, url: "https://api.test/requests/rq_int" }, deduplicated: false, request_id: "r4" }, { status: 201 })]);
    expect(await run(["request", "feature", "Interior views", "--details", "dashboard and seats"], fetchImpl, KEY)).toBe(0);
    expect(seen[0]?.body).toEqual({ kind: "feature", title: "Interior views", body: "dashboard and seats" });
    expect(out.join("")).toContain("Requested Interior views — 1 vote. Track it at https://api.test/requests/rq_int");
  });

  it("shows one request with its comments, without a key", async () => {
    const { fetchImpl, seen } = mockFetch([
      () =>
        Response.json({
          data: { ...RECORD, body: "Needed for a dealer site", votes: 3, comment_count: 1, comments: [{ id: "c1", request_id: "rq_sienna", body: "Also the hybrid", author: "Grace", created_at: "2026-09-11T01:00:00Z" }] },
          request_id: "r5",
        }),
    ]);
    expect(await run(["request", "show", "rq_sienna"], fetchImpl)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/requests/rq_sienna");
    expect(seen[0]?.auth).toBeNull();
    const text = out.join("");
    expect(text).toContain("Toyota Sienna (2024)");
    expect(text).toContain("Needed for a dealer site");
    expect(text).toContain("Comments (1)");
    expect(text).toContain("Grace");
    expect(text).toContain("Also the hybrid");
  });

  it("upvotes and comments", async () => {
    const { fetchImpl, seen } = mockFetch([
      () => Response.json({ data: { ...RECORD, votes: 2 }, request_id: "r6" }),
      () => Response.json({ data: { id: "c2", request_id: "rq_sienna", body: "Also the hybrid trim", author: "Ada", created_at: "2026-09-11T02:00:00Z" }, request_id: "r7" }, { status: 201 }),
    ]);
    expect(await run(["request", "upvote", "rq_sienna"], fetchImpl, KEY)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/requests/rq_sienna/votes");
    expect(seen[0]?.method).toBe("POST");
    expect(out.join("")).toContain("Upvoted Toyota Sienna (2024) — 2 votes.");
    out = [];
    expect(await run(["request", "comment", "rq_sienna", "Also the hybrid trim"], fetchImpl, KEY)).toBe(0);
    expect(seen[1]?.url).toBe("https://api.test/api/v1/requests/rq_sienna/comments");
    expect(seen[1]?.body).toEqual({ body: "Also the hybrid trim" });
    expect(out.join("")).toContain("Comment added to rq_sienna.");
  });

  it("stays available without being advertised: help lists it, a search with no matches no longer points at it", async () => {
    expect(await run(["help", "--all"])).toBe(0);
    expect(out.join("")).toContain("request (requests)");
    expect(out.join("")).toContain("about ");
    expect(out.join("")).not.toContain("car-image request vehicle Toyota Sienna");
    out = [];
    expect(await run(["--help"])).toBe(0);
    expect(out.join("")).not.toContain("request (requests)");
    out = [];
    const { fetchImpl } = mockFetch([() => Response.json({ data: { results: [] } })]);
    expect(await run(["search", "zorgomobile"], fetchImpl)).toBe(1);
    expect(out.join("")).toContain("No catalog matches");
    expect(out.join("")).not.toContain("request vehicle");
  });
});

describe("car-image about", () => {
  it("saves what you are building", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: { building: "a dealer site", updated_at: "2026-09-11T00:00:00Z" }, request_id: "r8" })]);
    expect(await run(["about", "building", "a", "dealer", "site"], fetchImpl, KEY)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/account/building");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.auth).toBe("Bearer cimg_test");
    expect(seen[0]?.body).toEqual({ building: "a dealer site" });
    expect(out.join("")).toBe(`${SAVED_MESSAGE}\n`);
  });

  it("saves a referral source with detail and validates the source", async () => {
    const { fetchImpl, seen } = mockFetch([() => Response.json({ data: { source: "hacker_news", detail: "Show HN", updated_at: "2026-09-11T00:00:00Z" }, request_id: "r9" })]);
    expect(await run(["about", "referral", "hacker-news", "--detail", "Show HN"], fetchImpl, KEY)).toBe(0);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/account/referral");
    expect(seen[0]?.body).toEqual({ source: "hacker_news", detail: "Show HN" });
    expect(out.join("")).toContain("Only the Car Image team sees this.");
    out = [];
    expect(await run(["about", "referral", "carrier-pigeon"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain('Unknown source "carrier-pigeon"');
    expect(err.join("")).toContain("search, ai_assistant, github, npm, twitter_x, linkedin, reddit, hacker_news, youtube, friend_or_colleague, blog_or_article, other");
  });

  it("needs a key and an action", async () => {
    expect(await run(["about", "building", "x"])).toBe(1);
    expect(err.join("")).toContain("Not signed in");
    err = [];
    expect(await run(["about"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain("Missing action");
    err = [];
    expect(await run(["about", "building"], undefined, KEY)).toBe(2);
    expect(err.join("")).toContain("Tell us what you are building");
  });
});
