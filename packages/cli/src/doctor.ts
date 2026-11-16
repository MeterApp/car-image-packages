import type { CarImageClient } from "@meterapp/car-image-sdk";
import { fixHintFor } from "./errors.js";
import { paint, table, type Io } from "./output.js";

export type CheckStatus = "pass" | "fail" | "skip";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  latencyMs: number | null;
  /** X-Image-Source: cache | generated. */
  cache: string | null;
  credits: number | null;
  notes: string;
  httpStatus: number | null;
  requestId: string | null;
  hint?: string;
}

export interface DoctorDeps {
  client: Pick<CarImageClient, "fetch">;
  /** Plain fetch without credentials, used to prove delivery URLs are public. */
  publicFetch: (url: string, init?: RequestInit) => Promise<Response>;
  hasKey: boolean;
  now(): number;
  /** Whether to make a keyed image GET (a vehicle image of the month; 1 credit on the legacy credit meter); already resolved from --yes/--no-image/prompt. */
  includeImage: boolean;
  /** Onboarding mode: stop after the free checks (no URL mint, no image). */
  quick?: boolean;
  onCheck?(check: DoctorCheck): void;
}

const PAID_CHECKS = ["image-urls", "delivery:head", "delivery:get", "image"] as const;

interface Evaluation {
  ok: boolean;
  notes: string;
  cache?: string | null;
  credits?: number | null;
  requestId?: string | null;
}

type Body = { json: unknown } | { bytes: number } | { text: string };

async function readBody(response: Response): Promise<Body> {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      return { json: await response.json() };
    } catch {
      return { text: "" };
    }
  }
  if (type.startsWith("image/")) {
    return { bytes: (await response.arrayBuffer()).byteLength };
  }
  return { text: await response.text().catch(() => "") };
}

function problemDetail(body: Body): string | null {
  if ("json" in body && body.json && typeof body.json === "object") {
    const record = body.json as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.title === "string") return record.title;
  }
  return null;
}

function get(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Runs one probe, timing it and converting any failure into a `fail` row. */
async function probe(
  deps: DoctorDeps,
  name: string,
  request: () => Promise<Response>,
  evaluate: (response: Response, body: Body) => Evaluation
): Promise<{ check: DoctorCheck; response: Response | null; body: Body | null }> {
  const started = deps.now();
  let check: DoctorCheck;
  let response: Response | null = null;
  let body: Body | null = null;
  try {
    response = await request();
    body = await readBody(response);
    const latencyMs = deps.now() - started;
    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const detail = problemDetail(body);
      check = {
        name,
        status: "fail",
        latencyMs,
        cache: null,
        credits: null,
        notes: `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        httpStatus: response.status,
        requestId,
        hint: fixHintFor(response.status, retryAfter(response)),
      };
    } else {
      const result = evaluate(response, body);
      check = {
        name,
        status: result.ok ? "pass" : "fail",
        latencyMs,
        cache: result.cache ?? response.headers.get("x-image-source"),
        credits: result.credits ?? numberHeader(response, "x-credits-charged"),
        notes: result.notes,
        httpStatus: response.status,
        requestId: result.requestId ?? requestId,
      };
    }
  } catch (error) {
    check = {
      name,
      status: "fail",
      latencyMs: deps.now() - started,
      cache: null,
      credits: null,
      notes: error instanceof Error ? error.message : String(error),
      httpStatus: null,
      requestId: null,
      hint: fixHintFor(0),
    };
  }
  deps.onCheck?.(check);
  return { check, response, body };
}

function numberHeader(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function skip(deps: DoctorDeps, name: string, notes: string, hint?: string): DoctorCheck {
  const check: DoctorCheck = { name, status: "skip", latencyMs: null, cache: null, credits: null, notes, httpStatus: null, requestId: null, hint };
  deps.onCheck?.(check);
  return check;
}

const JSON_HEADERS = { Accept: "application/json" };

/**
 * Full smoke test of every public and keyed endpoint. Uses one vehicle image
 * of the month (the signed URL and the optional keyed image GET ask for the
 * same one); on the legacy credit meter it spends at most 2 credits.
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const noKeyHint = "Run `car-image login` or set CAR_IMAGE_API_KEY.";

  // Public surface -------------------------------------------------------
  const health = await probe(deps, "health", () => deps.client.fetch("/api/health", { headers: JSON_HEADERS }), (_response, body) => {
    const status = get("json" in body ? body.json : null, "status");
    return { ok: status === "ok" || status === "degraded", notes: `status=${String(status ?? "unknown")}` };
  });
  checks.push(health.check);

  checks.push(
    (
      await probe(deps, "options", () => deps.client.fetch("/api/v1/images/options", { headers: JSON_HEADERS }), (_response, body) => {
        const views = get("json" in body ? body.json : null, "data.views");
        const colors = get("json" in body ? body.json : null, "data.colors");
        const ok = Array.isArray(views) && views.length === 6 && Array.isArray(colors) && colors.length === 15;
        return { ok, notes: `${Array.isArray(views) ? views.length : 0} views, ${Array.isArray(colors) ? colors.length : 0} colors` };
      })
    ).check
  );

  let year = 2024;
  const years = await probe(deps, "vehicles:years", () => deps.client.fetch("/api/v1/vehicles", { headers: JSON_HEADERS }), (_response, body) => {
    const list = get("json" in body ? body.json : null, "data.years");
    if (!Array.isArray(list) || list.length === 0) return { ok: false, notes: "no years returned" };
    const numbers = list.map(Number).filter(Number.isFinite);
    year = numbers.includes(2024) ? 2024 : Math.max(...numbers);
    return { ok: true, notes: `${numbers.length} years (${Math.min(...numbers)}–${Math.max(...numbers)})` };
  });
  checks.push(years.check);

  let makeId: number | null = null;
  const makes = await probe(deps, "vehicles:makes", () => deps.client.fetch(`/api/v1/vehicles?year=${year}`, { headers: JSON_HEADERS }), (_response, body) => {
    const list = get("json" in body ? body.json : null, "data.makes");
    if (!Array.isArray(list) || list.length === 0) return { ok: false, notes: `no makes for ${year}` };
    const porsche = list.find((make) => typeof make === "object" && make && /porsche/i.test(String((make as Record<string, unknown>).name)));
    const first = (porsche ?? list[0]) as Record<string, unknown>;
    makeId = Number(first.id);
    return { ok: Number.isFinite(makeId), notes: `${list.length} makes for ${year}; using ${String(first.name)} (#${String(first.id)})` };
  });
  checks.push(makes.check);

  if (makeId !== null) {
    checks.push(
      (
        await probe(deps, "vehicles:models", () => deps.client.fetch(`/api/v1/vehicles?year=${year}&makeId=${makeId}`, { headers: JSON_HEADERS }), (_response, body) => {
          const list = get("json" in body ? body.json : null, "data.models");
          return { ok: Array.isArray(list) && list.length > 0, notes: `${Array.isArray(list) ? list.length : 0} models` };
        })
      ).check
    );
  } else {
    checks.push(skip(deps, "vehicles:models", "skipped: no make id"));
  }

  checks.push(
    (
      await probe(deps, "search", () => deps.client.fetch("/api/v1/vehicles?q=porsche%20911&limit=5", { headers: JSON_HEADERS }), (_response, body) => {
        const results = get("json" in body ? body.json : null, "data.results");
        return { ok: Array.isArray(results) && results.length > 0, notes: `${Array.isArray(results) ? results.length : 0} results for "porsche 911"` };
      })
    ).check
  );

  // Keyed surface --------------------------------------------------------
  if (!deps.hasKey) {
    checks.push({ name: "auth", status: "fail", latencyMs: null, cache: null, credits: null, notes: "no API key configured", httpStatus: 401, requestId: null, hint: noKeyHint });
    for (const name of ["resolve", "account", ...PAID_CHECKS]) {
      checks.push(skip(deps, name, "skipped: no API key"));
    }
    return checks;
  }

  checks.push(
    (
      await probe(
        deps,
        "resolve",
        () =>
          deps.client.fetch("/api/v1/images/resolve", {
            method: "POST",
            headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
            body: JSON.stringify({ query: "red 2024 porsche 911 side view" }),
          }),
        (_response, body) => {
          const params = get("json" in body ? body.json : null, "data.params") as Record<string, unknown> | undefined;
          const ok = Boolean(params && /porsche/i.test(String(params.make)) && String(params.view) === "side" && String(params.color) === "red");
          return { ok, notes: params ? `${String(params.make)} ${String(params.model)} ${String(params.year)} ${String(params.view)} ${String(params.color)}` : "no params" };
        }
      )
    ).check
  );

  checks.push(
    (
      await probe(deps, "account", () => deps.client.fetch("/api/v1/account", { headers: JSON_HEADERS }), (_response, body) => {
        const credits = get("json" in body ? body.json : null, "data.credits");
        return { ok: typeof credits === "number", notes: typeof credits === "number" ? `credits=${credits.toLocaleString("en-US")}` : "no credits field" };
      })
    ).check
  );

  if (deps.quick) {
    for (const name of PAID_CHECKS) checks.push(skip(deps, name, "skipped in quick mode (uses a vehicle image of the month); run `car-image doctor`"));
    return checks;
  }

  let deliveryUrl: string | null = null;
  const mint = await probe(
    deps,
    "image-urls",
    () =>
      deps.client.fetch("/api/v1/image-urls", {
        method: "POST",
        headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ images: [{ make: "Porsche", model: "911", year: 2024, view: "front-3-4", width: 256 }], ttl_seconds: 600 }),
      }),
    (_response, body) => {
      const json = "json" in body ? body.json : null;
      const url = get(json, "data.0.url");
      const charged = get(json, "billing.credits_charged");
      const remaining = get(json, "billing.credits_remaining");
      const images = get(json, "billing.vehicle_images.used");
      if (typeof url !== "string") return { ok: false, notes: "no url in response" };
      deliveryUrl = url;
      return {
        ok: true,
        notes: `minted 1 URL; ${typeof images === "number" ? `${images.toLocaleString("en-US")} vehicle images this month` : typeof remaining === "number" ? `${remaining.toLocaleString("en-US")} credits left` : "ok"}`,
        credits: typeof charged === "number" ? charged : 1,
      };
    }
  );
  checks.push(mint.check);

  if (deliveryUrl) {
    const url: string = deliveryUrl;
    const head = await probe(deps, "delivery:head", () => deps.publicFetch(url, { method: "HEAD" }), (response) => {
      const type = response.headers.get("content-type") ?? "";
      return { ok: type.startsWith("image/"), notes: type ? `content-type ${type}` : "no content-type" };
    });
    if (head.check.status === "fail" && head.check.httpStatus === 405) {
      head.check.status = "skip";
      head.check.notes = "HEAD not supported (405)";
      head.check.hint = undefined;
    }
    checks.push(head.check);
    checks.push(
      (
        await probe(deps, "delivery:get", () => deps.publicFetch(url), (response, body) => {
          const type = response.headers.get("content-type") ?? "";
          const bytes = "bytes" in body ? body.bytes : 0;
          return { ok: type.startsWith("image/") && bytes > 0, notes: `${type || "unknown type"}, ${(bytes / 1024).toFixed(1)} KB` };
        })
      ).check
    );
  } else {
    checks.push(skip(deps, "delivery:head", "skipped: no URL minted"));
    checks.push(skip(deps, "delivery:get", "skipped: no URL minted"));
  }

  if (deps.includeImage) {
    const image = await probe(
      deps,
      "image",
      () => deps.client.fetch("/api/v1/images/car?make=Porsche&model=911&year=2024&view=front-3-4&w=256", { headers: { Accept: "image/*" } }),
      (response, body) => {
        const type = response.headers.get("content-type") ?? "";
        const bytes = "bytes" in body ? body.bytes : 0;
        const remaining = response.headers.get("x-credits-remaining");
        const images = response.headers.get("x-vehicle-images-used");
        return { ok: type.startsWith("image/") && bytes > 0, notes: `${type}, ${(bytes / 1024).toFixed(1)} KB${images ? `, ${images} vehicle images this month` : remaining ? `, ${remaining} credits left` : ""}` };
      }
    );
    checks.push(image.check);
  } else {
    checks.push(skip(deps, "image", "skipped (--no-image or declined); uses a vehicle image of the month"));
  }

  return checks;
}

export function doctorSummary(checks: DoctorCheck[]): { passed: number; failed: number; skipped: number; ok: boolean } {
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skip").length;
  return { passed, failed, skipped, ok: failed === 0 };
}

export function renderDoctorTable(checks: DoctorCheck[], io: Pick<Io, "color">): string {
  const rows = checks.map((check) => [
    check.name,
    check.status === "pass" ? paint(io, "green", "pass") : check.status === "fail" ? paint(io, "red", "FAIL") : paint(io, "dim", "skip"),
    check.latencyMs === null ? "—" : `${check.latencyMs} ms`,
    check.cache ?? "—",
    check.credits === null || check.credits === 0 ? "—" : String(check.credits),
    check.notes,
  ]);
  const body = table(rows, ["check", "status", "latency", "cache", "credits", "notes"]);
  const hints = checks
    .filter((check) => check.status === "fail" && check.hint)
    .map((check) => `  ${paint(io, "yellow", "→")} ${check.name}: ${check.hint}${check.requestId ? ` (request ${check.requestId})` : ""}`);
  return hints.length ? `${body}\n\nFixes:\n${hints.join("\n")}` : body;
}
