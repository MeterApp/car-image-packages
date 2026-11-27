import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { CarImageClient, CarImageError } from "@meterapp/car-image-sdk";
import { MCP_TOOLS, MCP_TOOLSETS, MCP_UNLISTED_TOOLS, nextStepFor, vinNextStepFor } from "@meterapp/car-image-sdk/mcp";
import { describe, expect, it } from "vitest";
import { buildStdioMcpServer, requestToolHandlers, toolErrorResult } from "./server.js";

const RECORD = {
  id: "0b1e2f3a-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
  kind: "vehicle",
  title: "Toyota Sienna (2024)",
  body: null,
  vehicle: { make: "Toyota", model: "Sienna", year: 2024 },
  status: "open",
  votes: 1,
  comments: 0,
  author: "Ada",
  url: "https://api.test/requests/0b1e2f3a-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
  created_at: "2026-09-11T00:00:00Z",
  updated_at: "2026-09-11T00:00:00Z",
};

function clientWith(responses: Response[]) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  };
  return { client: new CarImageClient({ apiKey: "cimg_test", baseUrl: "https://api.test", fetch: fetchImpl }), calls };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

describe("stdio MCP request tools", () => {
  it("has a handler for every request-board tool the SDK defines", () => {
    const { client } = clientWith([]);
    const handlers = Object.keys(requestToolHandlers(client)).sort();
    const defined = Object.keys(MCP_TOOLS).filter((name) => /request|share_|feedback|issue|review/.test(name)).sort();
    expect(handlers).toEqual(defined);
  });

  it("calls the REST API through the SDK with the SDK's argument names and summarizes the outcome", async () => {
    const { client, calls } = clientWith([
      Response.json({ data: [RECORD], next_cursor: null, request_id: "a" }),
      Response.json({ data: RECORD, deduplicated: true, request_id: "b" }),
      Response.json({ created: true, data: { ...RECORD, id: "rq_2", kind: "feature", title: "Interior views" }, similar: [], request_id: "c" }, { status: 201 }),
      Response.json({ data: { ...RECORD, comment_count: 0, comments: [] }, request_id: "d" }),
      Response.json({ data: { ...RECORD, votes: 2 }, request_id: "e" }),
      Response.json({ data: { id: "c1", request_id: RECORD.id, body: "hi", author: "Ada", created_at: "x" }, request_id: "f" }, { status: 201 }),
      Response.json({ data: { building: "a site", updated_at: "x" }, request_id: "g" }),
      Response.json({ data: { source: "npm", detail: null, updated_at: "x" }, request_id: "h" }),
    ]);
    const handlers = requestToolHandlers(client);

    const list = await handlers.list_requests(MCP_TOOLS.list_requests.inputSchema.parse({ kind: "vehicle", cursor: "abc" }));
    expect(text(list)).toContain("1 request(s)");
    expect(calls[0]?.url).toBe("https://api.test/api/v1/requests?kind=vehicle&sort=top&limit=25&cursor=abc");

    const vehicle = await handlers.request_vehicle(MCP_TOOLS.request_vehicle.inputSchema.parse({ make: "Toyota", model: "Sienna", year: "2024", note: "hybrid" }));
    expect(text(vehicle)).toContain("already existed");
    expect(calls[1]?.body).toEqual({ kind: "vehicle", make: "Toyota", model: "Sienna", year: 2024, body: "hybrid" });

    const feature = await handlers.request_feature(MCP_TOOLS.request_feature.inputSchema.parse({ title: "Interior views", body: "dashboard and seats" }));
    expect(text(feature)).toContain('Feature request filed: "Interior views"');
    expect(calls[2]?.url).toBe("https://api.test/api/v1/feedback/features");
    expect(calls[2]?.body).toEqual({ title: "Interior views", body: "dashboard and seats" });

    const detail = await handlers.get_request({ id: RECORD.id });
    expect(text(detail)).toContain("0 comment(s)");
    expect(calls[3]?.url).toBe(`https://api.test/api/v1/requests/${RECORD.id}`);

    const vote = await handlers.upvote_request({ id: RECORD.id });
    expect(text(vote)).toContain("2 votes");
    expect(calls[4]?.method).toBe("POST");
    expect(calls[4]?.body).toEqual({});

    await handlers.comment_on_request({ id: RECORD.id, body: "hi" });
    expect(calls[5]?.url).toBe(`https://api.test/api/v1/requests/${RECORD.id}/comments`);

    const building = await handlers.share_building({ building: "a site" });
    expect(text(building)).toContain("Only the Car Image team sees this");
    expect(calls[6]?.body).toEqual({ building: "a site" });

    await handlers.share_referral({ source: "npm" });
    expect(calls[7]?.body).toEqual({ source: "npm" });
  });

  it("files features and issues through the canonical paths and says what to upvote when similar items exist", async () => {
    const { client, calls } = clientWith([
      Response.json({ created: false, data: null, similar: [{ ...RECORD, kind: "feature", title: "Interior views", votes: 4 }], request_id: "a" }),
      Response.json({ created: true, data: { ...RECORD, kind: "issue", title: "502 on side views", visibility: "private" }, similar: [], request_id: "b" }, { status: 201 }),
      Response.json({ data: [RECORD], next_cursor: null, request_id: "c" }),
      Response.json({ data: [RECORD], next_cursor: null, request_id: "d" }),
      Response.json({ data: { ...RECORD, votes: 5 }, request_id: "e" }),
      Response.json({ data: { ...RECORD, votes: 4 }, request_id: "f" }),
      Response.json({ data: { id: "r1", rating: 5, title: null, body: "Great", display_name: "Ada", created_at: "x", status: "published", marketing_consent: false, response: null }, created: true, request_id: "g" }, { status: 201 }),
      Response.json({ data: [], summary: { count: 0, average: null, distribution: {} }, next_cursor: null, request_id: "h" }),
    ]);
    const handlers = requestToolHandlers(client);
    const similar = await handlers.request_feature(MCP_TOOLS.request_feature.inputSchema.parse({ title: "Interior views" }));
    expect(text(similar)).toContain("Nothing filed: 1 similar item(s)");
    expect(text(similar)).toContain("upvote_feedback");
    const issue = await handlers.report_issue(MCP_TOOLS.report_issue.inputSchema.parse({ title: "502 on side views", request_id: "req_9", context: { endpoint: "get_car_image" } }));
    expect(text(issue)).toContain("Issue reported");
    expect(calls[1]?.url).toBe("https://api.test/api/v1/feedback/issues");
    expect(calls[1]?.body).toMatchObject({ title: "502 on side views", context: { request_id: "req_9", endpoint: "get_car_image", client: "car-image-mcp" } });
    await handlers.list_feedback(MCP_TOOLS.list_feedback.inputSchema.parse({ kind: "issue", q: "side" }));
    expect(calls[2]?.url).toBe("https://api.test/api/v1/feedback?kind=issue&sort=top&q=side&limit=25");
    await handlers.list_my_feedback(MCP_TOOLS.list_my_feedback.inputSchema.parse({}));
    expect(calls[3]?.url).toBe("https://api.test/api/v1/feedback?sort=recent_activity&limit=25&mine=true");
    await handlers.upvote_feedback({ id: RECORD.id });
    expect(calls[4]?.url).toBe(`https://api.test/api/v1/feedback/${RECORD.id}/votes`);
    await handlers.remove_feedback_vote({ id: RECORD.id });
    expect(calls[5]?.method).toBe("DELETE");
    const review = await handlers.submit_review(MCP_TOOLS.submit_review.inputSchema.parse({ rating: "5", body: "Great" }));
    expect(text(review)).toContain("Review posted (5/5)");
    expect(calls[6]).toMatchObject({ url: "https://api.test/api/v1/reviews/me", method: "PUT", body: { rating: 5, body: "Great" } });
    const reviews = await handlers.list_reviews(MCP_TOOLS.list_reviews.inputSchema.parse({}));
    expect(text(reviews)).toContain("No reviews yet.");
  });

  it("points an agent at report_issue with the request id when the server fails", () => {
    const result = toolErrorResult(new CarImageError({ status: 502, title: "Upstream failed", detail: "render timed out", requestId: "req_502" }));
    expect(text(result)).toContain("report_issue with request_id req_502");
    expect(text(toolErrorResult(new CarImageError({ status: 404, title: "Not found", detail: "no car", requestId: "req_404" })))).not.toContain("report_issue");
  });

  it("forwards the REST problem's machine-readable fields in structuredContent", () => {
    const suggestions = [{ make: "lexus", make_name: "Lexus", model: "tx-350", model_name: "TX 350", year: 2024, id: "veh_8bbz514ey4ran", image_path: "/api/v1/images/car?vehicle=veh_8bbz514ey4ran" }];
    const problem = { title: "Vehicle not found", detail: "no match", status: 404, code: "vehicle_not_found", retryable: false, parameter: "vehicle", search: "/api/v1/vehicles?q=lexus+tx", next_step: "Search the catalog, then retry with an id.", suggestions, internal: "not forwarded" };
    const result = toolErrorResult(new CarImageError({ status: 404, title: "Vehicle not found", detail: "no match", requestId: "req_miss", problem }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 404, request_id: "req_miss", code: "vehicle_not_found", retryable: false, parameter: "vehicle", search: "/api/v1/vehicles?q=lexus+tx", next_step: "Search the catalog, then retry with an id.", suggestions });
    expect(result.structuredContent).not.toHaveProperty("internal");
    const bare = toolErrorResult(new CarImageError({ status: 404, title: "Not found", detail: "no car", requestId: "req_404" }));
    for (const key of ["code", "retryable", "parameter", "search", "next_step", "suggestions"]) expect(bare.structuredContent).not.toHaveProperty(key);
  });

  it("advertises the core tools by default and every tool on --toolset all", async () => {
    // Every registration used to default its toolset to `all`, so the stdio
    // server shipped the whole set whatever `--toolset` said; this pins what
    // each toolset advertises.
    const { client } = clientWith([]);
    const core = await listTools(buildStdioMcpServer(client));
    expect(core).toEqual([...MCP_TOOLSETS.core].sort());
    expect(core).toHaveLength(MCP_TOOLSETS.core.length);
    for (const name of [...MCP_UNLISTED_TOOLS, "create_3d_model", "get_make_logo", "describe_api", "list_image_options"]) expect(core).not.toContain(name);
    const all = await listTools(buildStdioMcpServer(client, "all"));
    expect(all).toEqual(Object.keys(MCP_TOOLS).sort());
  });

  it("gives each toolset the instructions for its own tools", async () => {
    const { client } = clientWith([]);
    const core = await instructionsOf(buildStdioMcpServer(client));
    expect(core).toContain("check_vehicles");
    expect(core).not.toContain("create_3d_model");
    expect(core).not.toContain("request_vehicle");
    expect(core).not.toContain("/requests");
    const all = await instructionsOf(buildStdioMcpServer(client, "all"));
    expect(all).toContain("Confirm with the human before calling create_3d_model.");
    expect(all).not.toContain("request_vehicle");
  });
});

/** One JSON-RPC request against a freshly built stdio server, over the streamable transport in stateless mode. */
async function rpcOnce(server: ReturnType<typeof buildStdioMcpServer>, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request("https://stdio.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    })
  );
  const payload = (await response.json()) as Record<string, unknown>;
  await transport.close();
  return payload;
}

async function listTools(server: ReturnType<typeof buildStdioMcpServer>): Promise<string[]> {
  const payload = (await rpcOnce(server, { method: "tools/list" })) as { result: { tools: Array<{ name: string }> } };
  return payload.result.tools.map((tool) => tool.name).sort();
}

async function instructionsOf(server: ReturnType<typeof buildStdioMcpServer>): Promise<string> {
  const payload = (await rpcOnce(server, {
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  })) as { result: { instructions: string } };
  return payload.result.instructions;
}

const VEHICLE = { vehicle_id: "veh_395yw8tn73ff8", make: "Porsche", model: "911", year: 2024, view: "front-3-4", color: "silver", format: "png" };

const MODEL_3D = {
  id: "22222222-2222-4222-8222-222222222222",
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

const VIN = {
  vin: "1HGCM82633A004352",
  valid: true,
  errors: [],
  suggested_vin: null,
  year: 2003,
  make: "Honda",
  model: "Accord",
  trim: "EX-V6",
  series: null,
  body_class: "Sedan/Saloon",
  vehicle_type: "Passenger Car",
  doors: 4,
  drive_type: null,
  fuel_type: "Gasoline",
  engine: { cylinders: 6, displacement_l: 3, hp: null, model: "J30A4" },
  transmission: { style: "Automatic", speeds: 5 },
  manufacturer: "American Honda Motor Co., Inc.",
  plant: { city: "Marysville", state: "Ohio", country: "United States (USA)" },
  gvwr: null,
  attributes: { Make: "HONDA", Model: "Accord" },
  vehicle: { id: "veh_395yw8tn73ff8", make: "Honda", model: "Accord", year: 2003, image_path: "/api/v1/images/car?vehicle=veh_395yw8tn73ff8" },
  source: "vpic-db",
};

interface ToolCallPayload {
  error?: { message: string };
  result?: { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> };
}

/**
 * Calls one tool on the real stdio server with canned REST responses.
 *
 * The MCP server validates every result against the output schema the SDK
 * advertises, so a call that comes back without an error is itself the proof
 * that this server's payload matches the shape the remote server promises for
 * the same tool — the two answer the same agents and must not diverge.
 */
async function callTool(responses: Response[], name: string, args: Record<string, unknown> = {}, calls: Array<{ url: string; method: string; body: unknown }> = []): Promise<Record<string, unknown>> {
  return (await callToolWithSummary(responses, name, args, calls)).structured;
}

it.each(["structured", "text"])("refuses oversized %s tool arguments before the stdio server calls REST", async (encoding) => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const values = Array(10_001).fill(0);
  const payload = await toolCallPayload([], "create_car_image_urls", { images: encoding === "text" ? JSON.stringify(values) : values }, calls);
  expect(payload.error !== undefined || payload.result?.isError === true).toBe(true);
  expect(payload.error?.message ?? payload.result?.content[0]?.text).toMatch(/maximum of 10000 elements/);
  expect(calls).toHaveLength(0);
});

/** One tools/call on the real stdio server with canned REST responses; `calls` receives the requests it sent. */
async function toolCallPayload(responses: Response[], name: string, args: Record<string, unknown>, calls: Array<{ url: string; method: string; body: unknown }>): Promise<ToolCallPayload> {
  const { client, calls: seen } = clientWith(responses);
  const server = buildStdioMcpServer(client, "all");
  calls.splice(0, calls.length, ...seen);
  const observe = () => calls.splice(0, calls.length, ...seen);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request("https://stdio.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  const payload = (await response.json()) as ToolCallPayload;
  await transport.close();
  observe();
  return payload;
}

/** {@link callTool}, plus the summary line the agent reads above the structured content. */
async function callToolWithSummary(
  responses: Response[],
  name: string,
  args: Record<string, unknown> = {},
  calls: Array<{ url: string; method: string; body: unknown }> = []
): Promise<{ structured: Record<string, unknown>; summary: string }> {
  const payload = await toolCallPayload(responses, name, args, calls);
  const failure = payload.error?.message ?? (payload.result?.isError === true ? payload.result.content.map((part) => part.text ?? "").join(" ") : null);
  expect(failure, `${name} did not answer in its advertised shape`).toBeNull();
  // jsonToolResult writes the summary, a blank line, then the JSON.
  return { structured: payload.result?.structuredContent ?? {}, summary: (payload.result?.content[0]?.text ?? "").split("\n\n")[0] ?? "" };
}

/** A call that must fail: the text the agent reads, and the structured error. */
async function callToolError(responses: Response[], name: string, args: Record<string, unknown> = {}): Promise<{ text: string; structured: Record<string, unknown> }> {
  const payload = await toolCallPayload(responses, name, args, []);
  expect(payload.result?.isError, `${name} did not fail`).toBe(true);
  return { text: text(payload.result ?? { content: [] }), structured: payload.result?.structuredContent ?? {} };
}

/** A problem+json answer as the REST API sends it. */
function problemResponse(status: number, title: string, detail: string, requestId: string): Response {
  return new Response(JSON.stringify({ type: `https://carimage.dev/docs/errors#${status}`, title, status, detail, request_id: requestId }), {
    status,
    headers: { "Content-Type": "application/problem+json", "X-Request-Id": requestId },
  });
}

describe("stdio MCP output schemas", () => {
  it("declares one for every tool but describe_api, whose result is prose", () => {
    const missing = Object.values(MCP_TOOLS).filter((tool) => !tool.outputSchema).map((tool) => tool.name);
    expect(missing).toEqual(["describe_api"]);
  });

  it("returns the image usage block the schema promises, ETag included", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const structured = await callTool(
      [
        new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "x-credits-charged": "1",
            "x-credits-remaining": "99",
            "x-image-source": "cache",
            "x-image-width": "1024",
            "x-image-height": "1024",
            etag: '"abc123"',
            "x-request-id": "req_img",
          },
        }),
      ],
      "get_car_image",
      { make: "Porsche", model: "911", year: 2024 }
    );
    expect(structured).toMatchObject({ credits_charged: 1, credits_remaining: 99, source: "cache", etag: '"abc123"', request_id: "req_img" });
    // Without a vehicle id and without X-Vehicle-Id nothing names the catalog vehicle.
    expect(structured.vehicle).toMatchObject({ vehicle_id: null, make: "Porsche", model: "911", year: 2024, color: "silver" });
  });

  it("passes the upgrade offer from a REST image allowance refusal to the local MCP client", async () => {
    const checkout = "https://checkout.example.test/upgrade";
    const problem = {
      title: "Plan limit reached",
      status: 402,
      detail: "The Free plan includes 30 free vehicle images per account plus a one-time courtesy of 30 and this account has used 60.",
      request_id: "req_limit",
      code: "plan_image_limit",
      plan: "free",
      used: 60,
      included: 60,
      requested: 1,
      resets_at: null,
      checkout_url: checkout,
      next_plan: { id: "pro", name: "Pro", price: { monthly: 49, yearly: 490 }, checkout_url: checkout },
      pack_url: "https://checkout.example.test/packs",
    };
    const { structured, text } = await callToolError(
      [Response.json(problem, { status: 402, headers: { "Content-Type": "application/problem+json" } })],
      "get_car_image",
      { make: "Porsche", model: "911", year: 2024 }
    );
    expect(structured).toMatchObject({
      status: 402, request_id: "req_limit", code: "plan_image_limit", plan: "free",
      used: 60, included: 60, requested: 1, resets_at: problem.resets_at,
      checkout_url: checkout, next_plan: problem.next_plan, pack_url: problem.pack_url,
    });
    expect(text).toContain(checkout);
  });

  it("names the vehicle served from X-Vehicle-Id, as the hosted server's descriptor does", async () => {
    const structured = await callTool(
      [new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png", "x-credits-charged": "1", "x-credits-remaining": "99", "x-vehicle-id": "veh_395yw8tn73ff8", "x-request-id": "req_img" } })],
      "get_car_image",
      { make: "Porsche", model: "911", year: 2024 }
    );
    expect(structured.vehicle).toMatchObject({ vehicle_id: "veh_395yw8tn73ff8", make: "Porsche", model: "911", year: 2024 });
  });

  it("renders by vehicle id, filling the descriptor from the free lookup before spending the credit", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const structured = await callTool(
      [
        Response.json({
          data: { id: "veh_395yw8tn73ff8", make: { id: 1, name: "Porsche", slug: "porsche" }, model: { name: "911", slug: "911", vehicle_type: "Passenger Car" }, year: 2024, years: [2024], year_ranges: [], image_path: "/api/v1/images/car?vehicle=veh_395yw8tn73ff8", images: {} },
          request_id: "req_veh",
        }),
        new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png", "x-credits-charged": "1", "x-credits-remaining": "98", "x-request-id": "req_img2" } }),
      ],
      "get_car_image",
      { vehicle: "veh_395yw8tn73ff8", color: "#1A2B3C", view: "side" },
      calls
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.test/api/v1/vehicles/veh_395yw8tn73ff8",
      "https://api.test/api/v1/images/car?vehicle=veh_395yw8tn73ff8&view=side&color=1a2b3c&format=png",
    ]);
    expect(structured.vehicle).toEqual({ vehicle_id: "veh_395yw8tn73ff8", make: "porsche", model: "911", year: 2024, view: "side", color: "#1a2b3c", format: "png" });
  });

  it("passes check_vehicles' views to the REST check and says how many vehicles have all nine", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const vehicle = { id: "veh_395yw8tn73ff8", make: "ford", make_name: "FORD", model: "f-150", model_name: "F-150", year: 2023, match: "exact", image_path: "/api/v1/images/car?vehicle=veh_395yw8tn73ff8" };
    const answer = {
      data: { summary: { total: 1, match: 1, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 1, views_complete: 0 }, results: [{ index: 0, status: "match", vehicle, views: { prepared: 7, missing: ["rear"] } }] },
      request_id: "req_check",
    };
    const { structured, summary } = await callToolWithSummary([Response.json(answer)], "check_vehicles", { vehicles: [{ vehicle: vehicle.id }], views: true }, calls);
    expect(calls[0]).toMatchObject({ url: "https://api.test/api/v1/vehicles/check", method: "POST", body: { vehicles: [{ vehicle: vehicle.id }], views: true } });
    expect((structured.data as { results: Array<{ views?: unknown }> }).results[0]?.views).toEqual({ prepared: 7, missing: ["rear"] });
    expect(summary).toContain("0 of 1 have all nine views prepared");
  });

  it("decodes a VIN and reads or creates 3D models in the shapes the schemas promise", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const vin = await callTool([Response.json({ data: VIN, request_id: "req_vin" })], "decode_vin", { vin: "1hgcm82633a004352", year: 2003 }, calls);
    expect(calls[0]?.url).toBe("https://api.test/api/v1/vin/1hgcm82633a004352?year=2003");
    expect((vin.data as { vehicle: { id: string } }).vehicle.id).toBe("veh_395yw8tn73ff8");

    const created = await callTool(
      [Response.json({ data: MODEL_3D, billing: { charged_on: "creation", credits_charged: 100, credits_remaining: 4000, already_owned: false }, request_id: "req_3d" }, { status: 202 })],
      "create_3d_model",
      { vehicle: "veh_errc87t1jgata", color: "1a2b3c", webhook_url: "https://hooks.example.com/x", webhook_secret: "s3cret", idempotency_key: "model-1" },
      calls
    );
    expect(calls[0]).toMatchObject({ url: "https://api.test/api/v1/3d", method: "POST", body: { vehicle: "veh_errc87t1jgata", color: "1a2b3c", webhook_url: "https://hooks.example.com/x", webhook_secret: "s3cret" } });
    expect((created.billing as { credits_charged: number }).credits_charged).toBe(100);

    const ready = { ...MODEL_3D, status: "ready", progress: 100, stage: "done", files: { glb: { url: "https://api.test/api/v1/3d/x/files/glb", bytes: 6409636, content_type: "model/gltf-binary" } }, estimated_seconds_remaining: null, ready_at: "2026-09-16T02:16:05.000Z" };
    const model = await callTool([Response.json({ data: ready, request_id: "req_get" })], "get_3d_model", { id: MODEL_3D.id }, calls);
    expect(calls[0]?.url).toBe(`https://api.test/api/v1/3d/${MODEL_3D.id}`);
    expect((model.data as { status: string }).status).toBe("ready");
  });

  it("adds inline Markdown to signed URLs", async () => {
    const urls = await callTool(
      [
        Response.json(
          {
            data: [{ id: "u1", url: "https://api.test/api/v1/delivery/token", expires_at: "2026-09-14T00:00:00Z", max_uses: 0, vehicle: VEHICLE }],
            billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 98, credits_per_url: 1 },
            request_id: "req_urls",
          },
          { status: 201 }
        ),
      ],
      "create_car_image_urls",
      { images: [{ make: "Porsche", model: "911", year: 2024 }] }
    );
    expect(urls.data).toHaveLength(1);
    expect((urls.data as Array<{ markdown: string }>)[0]?.markdown).toContain("](<https://api.test/api/v1/delivery/token>)");

  });

  it("files report_image through the image-reports path and shows the private page", async () => {
    const report = {
      object: "image_report", id: "0b9f3c1e-6a3e-4d55-9b52-0d1d2c6f7a10", url: "https://api.test/dashboard/image-reports/0b9f3c1e-6a3e-4d55-9b52-0d1d2c6f7a10",
      type: "wrong_image", status: "reported", flagged: false, category: "camera", asset_id: "6f1c2d4e-0000-4000-8000-000000000001",
      vehicle: { make: "Porsche", model: "911", year: 2024 }, view: "side", color: "red", reason: null, external_ref: "t-1", report_count: 1, created_at: "2026-11-23T00:00:00Z",
    };
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const { structured, summary } = await callToolWithSummary(
      [Response.json({ data: report, created: true, request_id: "req_rep" }, { status: 201 })],
      "report_image",
      { request_id: "req_img", category: "camera", external_ref: "t-1" },
      calls
    );
    expect(calls[0]).toMatchObject({ url: "https://api.test/api/v1/images/reports", method: "POST", body: { request_id: "req_img", category: "camera", external_ref: "t-1" } });
    expect(structured).toMatchObject({ data: { id: report.id }, created: true });
    expect(summary).toContain(report.url);

    const missing = { ...report, type: "missing_vehicle", category: null, asset_id: null, view: null, color: null, vehicle: { make: "Rivian", model: "R3", year: 2026 } };
    const folded = await callToolWithSummary(
      [Response.json({ data: missing, created: false, request_id: "req_rep2" })],
      "report_image",
      { type: "missing_vehicle", make: "Rivian", model: "R3", year: "2026" },
      calls
    );
    expect(calls[0]?.body).toEqual({ type: "missing_vehicle", make: "Rivian", model: "R3", year: 2026 });
    expect(folded.summary).toMatch(/^Added to the human's open report/);

    expect((await callToolError([], "report_image", { category: "identity" })).text).toMatch(/Identify the image/);
    expect((await callToolError([], "report_image", { type: "missing_vehicle", make: "Rivian" })).text).toMatch(/make, model and year/);
  });

  it("reads arguments a host sent as text before calling the API", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const urls = await callTool(
      [
        Response.json(
          {
            data: [{ id: "u1", url: "https://api.test/api/v1/delivery/token", expires_at: "2026-10-07T00:00:00Z", max_uses: 0, vehicle: VEHICLE }],
            billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 98, credits_per_url: 1 },
            request_id: "req_urls",
          },
          { status: 201 }
        ),
      ],
      "create_car_image_urls",
      { images: '[{"make": "Porsche", "model": "911", "year": 2024, "width": 960, "height": 600, "trim": true, "padding": 8}]', ttl_seconds: "604800", max_uses: "0", renew: "false" },
      calls
    );
    expect(urls.data).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      images: [{ make: "Porsche", model: "911", year: 2024, width: 960, height: 600, trim: true, padding: 8 }],
      ttl_seconds: 604800,
      max_uses: 0,
      renew: false,
    });

    const refused = await callToolError([], "get_car_image", { make: "Porsche", model: "911", year: "2024", trim: "perhaps" });
    expect(refused.text).toMatch(/trim: .*expected boolean/);
  });

  it("sends the agent's idempotency_key as the header and says so when the server replays", async () => {
    const payload = {
      data: [{ id: "u1", url: "https://api.test/api/v1/delivery/token", expires_at: "2026-09-14T00:00:00Z", max_uses: 0, vehicle: VEHICLE }],
      billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 98, credits_per_url: 1 },
      request_id: "req_urls",
    };
    const { client, calls } = clientWith([Response.json(payload, { status: 201, headers: { "Idempotent-Replayed": "true" } })]);
    const server = buildStdioMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request("https://stdio.test/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_car_image_urls", arguments: { images: [{ make: "Porsche", model: "911", year: 2024, format: "auto" }], idempotency_key: "listing-4711" } },
        }),
      })
    );
    const payloadOut = (await response.json()) as ToolCallPayload;
    await transport.close();
    expect(payloadOut.result?.isError).toBeUndefined();
    expect(calls[0]?.headers.get("idempotency-key")).toBe("listing-4711");
    // A signed URL keeps auto: the viewer negotiates on every load.
    expect(calls[0]?.body).toMatchObject({ images: [{ make: "Porsche", model: "911", year: 2024, format: "auto" }] });
    expect(payloadOut.result?.structuredContent).toMatchObject({ idempotent_replayed: true, data: [{ url: payload.data[0].url, markdown: expect.stringContaining(payload.data[0].url) }] });
    expect(calls).toHaveLength(1);
    expect(text(payloadOut.result!)).toContain("Replayed the result stored for this idempotency_key");
  });

  it("passes campaign and pieces through create_car_image_urls, per image and for the batch", async () => {
    const payload = {
      data: [{ id: "u1", url: "https://api.test/api/v1/delivery/token", expires_at: "2026-09-14T00:00:00Z", max_uses: 0, vehicle: VEHICLE, campaign: "Owners mailer", pieces: 3200 }],
      billing: { charged_on: "creation", credits_charged: 0 },
      campaign: "Owners mailer",
      pieces: 3200,
      request_id: "req_urls",
    };
    const { client, calls } = clientWith([Response.json(payload, { status: 201 })]);
    const server = buildStdioMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request("https://stdio.test/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_car_image_urls", arguments: { images: [{ make: "Porsche", model: "911", year: 2024, pieces: 3200 }], campaign: "Owners mailer", pieces: 1 } },
        }),
      })
    );
    const payloadOut = (await response.json()) as ToolCallPayload;
    await transport.close();
    expect(payloadOut.result?.isError).toBeUndefined();
    expect(calls[0]?.body).toMatchObject({ images: [{ make: "Porsche", model: "911", year: 2024, pieces: 3200 }], campaign: "Owners mailer", pieces: 1 });
    expect(payloadOut.result?.structuredContent).toMatchObject({ campaign: "Owners mailer", pieces: 3200, data: [{ pieces: 3200 }] });
  });

  it("fetches png for an inline image asked for as auto", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const { client, calls } = clientWith([
      new Response(bytes, { headers: { "content-type": "image/png", "x-credits-charged": "1", "x-credits-remaining": "99", "x-image-source": "cache", "x-image-width": "256", "x-image-height": "256", etag: '"a"', "x-request-id": "req_img" } }),
    ]);
    const server = buildStdioMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request("https://stdio.test/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_car_image", arguments: { make: "Porsche", model: "911", year: 2024, size: "thumb", format: "auto" } } }),
      })
    );
    const payloadOut = (await response.json()) as ToolCallPayload;
    await transport.close();
    expect(payloadOut.result?.isError).toBeUndefined();
    expect(new URL(calls[0]!.url).searchParams.get("format")).toBe("png");
    expect(payloadOut.result?.structuredContent).toMatchObject({ vehicle: { format: "png" } });
  });

  it("checks a list through POST /api/v1/vehicles/check, even one a host sent as text", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const answer = {
      data: {
        summary: { total: 2, match: 1, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 1 },
        results: [
          {
            index: 0,
            ref: "7",
            status: "match",
            vehicle: { id: "veh_59854qbgfvar3", make: "mazda", make_name: "Mazda", model: "mx-5", model_name: "MX-5", year: 2018, match: "alias", image_path: "/api/v1/images/car?vehicle=veh_59854qbgfvar3" },
          },
          { index: 1, status: "miss", vehicle: null, reason: "model", suggestions: [], search: "/api/v1/vehicles?q=toyota%20zzyzx" },
        ],
      },
      request_id: "req_check",
    };
    // A text-only host sends the list as the JSON it was written in, and the year and ref as text.
    const { structured, summary } = await callToolWithSummary(
      [Response.json(answer)],
      "check_vehicles",
      { vehicles: JSON.stringify([{ make: "Mazda", model: "MX-5 Miata", year: "2018", ref: 7 }, { make: "Toyota", model: "Zzyzx", year: 2024 }]) },
      calls
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", body: { vehicles: [{ make: "Mazda", model: "MX-5 Miata", year: 2018, ref: "7" }, { make: "Toyota", model: "Zzyzx", year: 2024 }] } });
    expect(calls[0]?.url).toMatch(/\/api\/v1\/vehicles\/check$/);
    expect(structured).toMatchObject({ data: answer.data, request_id: "req_check" });
    expect(summary).toBe(
      "Checked 2 vehicles: 1 match, 0 suggestions, 1 miss. Render each match by its vehicle.id (1 distinct vehicle). Skip each miss in every view and color; the human can request a missing vehicle at https://carimage.dev/requests?ref=mcp and gets an email when it is added."
    );
  });

  it("maps REST search hits onto the make/model spelling the schema advertises", async () => {
    const structured = await callTool(
      [
        Response.json({
          data: {
            query: "porsche 911",
            results: [
              {
                kind: "model",
                make_id: 1,
                make_name: "Porsche",
                make_slug: "porsche",
                model_name: "911",
                model_slug: "911",
                vehicle_type: "Passenger Car",
                years: [2024],
                year_ranges: [{ year_from: 2024, year_to: 2024 }],
                match_kind: "exact",
              },
              { kind: "make", make_id: 1, make_name: "Porsche", make_slug: "porsche", years: [2024], match_kind: "make" },
            ],
          },
          request_id: "req_search",
        }),
      ],
      "search_vehicles",
      { query: "porsche 911", limit: 10 }
    );
    const results = (structured.data as { results: Array<Record<string, unknown>> }).results;
    expect(results[0]).toMatchObject({ make: "Porsche", model: "911", model_slug: "911", vehicle_type: "Passenger Car" });
    // A make hit carries no model at all over REST; the schema promises a null.
    expect(results[1]).toMatchObject({ make: "Porsche", model: null, model_slug: null, vehicle_type: null });
  });

  it("flattens the options payload and moves credits_usd beside the balance", async () => {
    const options = await callTool(
      [
        Response.json({
          data: {
            views: [{ id: "front-3-4", label: "Front three-quarter", yaw_degrees: 35, description: "hero", aliases: ["hero"] }],
            colors: [{ name: "silver", hex: "#C0C0C0" }],
            sizes: { presets: { thumb: 256, small: 512, medium: 768, large: 1024 }, max: 1024, source: 2048 },
            formats: [{ id: "png", mime: "image/png", transparent: true }, { id: "webp", mime: "image/webp", transparent: true }],
            pricing: { credits_per_image: 1, credits_per_dollar: 100, free_credits: 100 },
            catalog: { makes: 1599, models: 44254, years: { from: 1990, to: 2027 }, sources: [{ id: "nhtsa-cvs", name: "NHTSA", region: "US", license: "public domain" }] },
            limits: { max_batch_urls: 50 },
          },
          request_id: "req_opts",
        }),
      ],
      "list_image_options"
    );
    const data = options.data as { formats: string[]; catalog: { years: number[]; sources: string[] }; limits?: unknown };
    expect(data.formats).toEqual(["png", "webp"]);
    expect(data.catalog.years).toEqual([1990, 2027]);
    expect(data.catalog.sources).toEqual(["nhtsa-cvs"]);
    // Everything the endpoint adds rides along; the schema allows it.
    expect(data.limits).toEqual({ max_batch_urls: 50 });

    const account = await callTool(
      [
        Response.json({
          data: {
            credits: 2500,
            credits_value_usd: 2.5,
            auto_reload: false,
            has_payment_method: true,
            pricing: { credits_per_image: 1, credits_per_dollar: 100, packs: [{ credits: 500, cents: 500, label: "$5" }] },
            usage_30d: { requests: 12, images: 10, cache_hit_rate: 0.8 },
            key: { id: "key_1", scopes: ["images:read"], rate_limit_per_minute: 60 },
          },
          links: { docs: "/docs" },
          request_id: "req_acct",
        }),
      ],
      "get_account"
    );
    expect((account.data as { credits_usd: number }).credits_usd).toBe(25);
  });

  it("resolves free text into the parameters block the schema promises", async () => {
    const structured = await callTool(
      [
        Response.json({
          data: {
            params: { vehicle_id: "veh_395yw8tn73ff8", make: "Porsche", model: "911", year: 2024, view: "side", color: "red" },
            display: { make_name: "Porsche", model_name: "911" },
            candidates: [{ make_name: "Porsche", make_slug: "porsche", model_name: "911", model_slug: "911", years: [2024], match_kind: "exact" }],
            confidence: "high",
            image_path: "/api/v1/images/car?make=Porsche",
            extracted: { year: 2024, color: "red", view: "side", size: null, width: null, format: null },
          },
          request_id: "req_resolve",
        }),
      ],
      "resolve_vehicle",
      { query: "red 2024 porsche 911 side view" }
    );
    expect(structured.cli).toContain("--view side");
  });

  it("answers every request-board and survey tool in its advertised shape", async () => {
    await callTool([Response.json({ data: [RECORD], next_cursor: null, request_id: "a" })], "list_requests", { sort: "top", limit: 25 });
    await callTool([Response.json({ data: RECORD, deduplicated: true, request_id: "b" })], "request_vehicle", { make: "Toyota", model: "Sienna" });
    await callTool([Response.json({ created: true, data: { ...RECORD, kind: "feature" }, similar: [], request_id: "c" }, { status: 201 })], "request_feature", { title: "Interior views" });
    await callTool([Response.json({ created: false, data: null, similar: [RECORD], request_id: "c2" })], "report_issue", { title: "Broken" });
    await callTool([Response.json({ data: [RECORD], next_cursor: null, request_id: "c3" })], "list_feedback", {});
    await callTool([Response.json({ data: [RECORD], next_cursor: null, request_id: "c4" })], "list_my_feedback", {});
    await callTool([Response.json({ data: { ...RECORD, comment_count: 0, comments: [], timeline: [] }, request_id: "c5" })], "get_feedback", { id: RECORD.id });
    await callTool([Response.json({ data: { ...RECORD, votes: 2 }, request_id: "c6" })], "upvote_feedback", { id: RECORD.id });
    await callTool([Response.json({ data: RECORD, request_id: "c7" })], "remove_feedback_vote", { id: RECORD.id });
    await callTool([Response.json({ data: { id: "c1", request_id: RECORD.id, body: "hi", author: "Ada", created_at: "x" }, request_id: "c8" }, { status: 201 })], "comment_on_feedback", { id: RECORD.id, body: "hi" });
    await callTool(
      [Response.json({ data: { id: "r1", rating: 4, title: null, body: null, display_name: "Ada", created_at: "x", status: "pending", marketing_consent: false, response: null }, created: true, request_id: "c9" }, { status: 201 })],
      "submit_review",
      { rating: 4 }
    );
    await callTool([Response.json({ data: [], summary: { count: 0, average: null, distribution: {} }, next_cursor: null, request_id: "c10" })], "list_reviews", {});
    await callTool([Response.json({ data: { ...RECORD, comment_count: 0, comments: [] }, request_id: "d" })], "get_request", { id: RECORD.id });
    await callTool([Response.json({ data: { ...RECORD, votes: 2 }, request_id: "e" })], "upvote_request", { id: RECORD.id });
    await callTool(
      [Response.json({ data: { id: "c1", request_id: RECORD.id, body: "hi", author: "Ada", created_at: "2026-09-11T00:00:00Z" }, request_id: "f" }, { status: 201 })],
      "comment_on_request",
      { id: RECORD.id, body: "hi" }
    );
    await callTool([Response.json({ data: { building: "a dealer site", updated_at: "2026-09-11T00:00:00Z" }, request_id: "g" })], "share_building", { building: "a dealer site" });
    await callTool([Response.json({ data: { source: "npm", detail: null, updated_at: "2026-09-11T00:00:00Z" }, request_id: "h" })], "share_referral", { source: "npm" });
  });
});

/**
 * The summary line is what an agent reads first, and part of it is a stop
 * sign. The hosted server and this one build it with the same SDK helpers
 * from the payload they share, so a local `car-image mcp` tells an agent what
 * the hosted server would: when the balance is low, when a match is a guess,
 * and until when a signed URL serves.
 */
describe("stdio MCP summaries match the hosted server's", () => {
  it("names the plan and stops the agent on a low balance", async () => {
    const { summary } = await callToolWithSummary(
      [
        Response.json({
          data: {
            credits: 5,
            credits_value_usd: 0.05,
            auto_reload: false,
            has_payment_method: false,
            plan: { code: "pro", name: "Pro", limits: { vehicles_per_month: 2500 } },
            pricing: { credits_per_image: 1, credits_per_dollar: 100 },
            key: { id: "key_1", scopes: ["images:read"], rate_limit_per_minute: 60 },
          },
          request_id: "req_acct",
        }),
      ],
      "get_account"
    );
    expect(summary).toBe("5 credits ≈ $0.05 (1 credit per image) on the Pro plan, up to 2,500 distinct vehicles a month. Balance is low: ask the human before rendering more.");
  });

  it("asks for confirmation before spending credits on a low-confidence match", async () => {
    const { summary, structured } = await callToolWithSummary(
      [
        Response.json({
          data: {
            params: { vehicle_id: "veh_395yw8tn73ff8", make: "porsche", model: "911", year: 2024, view: "side", color: "red" },
            display: { make_name: "Porsche", model_name: "911" },
            candidates: [],
            confidence: "low",
            image_path: "/api/v1/images/car?make=porsche",
            extracted: { year: 2024, color: "red", view: "side", size: null, width: null, format: null },
          },
          request_id: "req_resolve",
        }),
      ],
      "resolve_vehicle",
      { query: "that red porsche" }
    );
    expect(summary).toBe(
      'Resolved to Porsche 911 2024, view side, color red (confidence low). Confidence is low: confirm with the human before making an image. Once they agree, show it with get_car_image (in chat; create_car_image_urls for a page, app, email or document, or in a terminal), passing vehicle: "veh_395yw8tn73ff8", view: "side" and color: "red".'
    );
    // The same words lead the structured result, which is all some hosts show a model.
    expect(structured.summary).toBe(summary);
  });

  it("says until when minted URLs serve, and passes a search hit's vehicle ids through", async () => {
    const urls = await callToolWithSummary(
      [
        Response.json(
          {
            data: [{ id: "u1", url: "https://api.test/api/v1/delivery/token", expires_at: "2026-09-14T00:00:00Z", max_uses: 0, renews_until: null, vehicle: VEHICLE }],
            billing: { charged_on: "creation", credits_charged: 1, credits_remaining: 98, credits_per_url: 1 },
            request_id: "req_urls",
          },
          { status: 201 }
        ),
      ],
      "create_car_image_urls",
      { images: [{ make: "Porsche", model: "911", year: 2024 }] }
    );
    expect(urls.summary).toContain("Created 1 signed URL; charged 1 credit, 98 remaining.");
    expect(urls.summary).toContain("they expire at 2026-09-14T00:00:00Z");

    const search = await callToolWithSummary(
      [
        Response.json({
          data: {
            query: "2024 porsche 911",
            results: [{ kind: "model", make_name: "Porsche", make_slug: "porsche", model_name: "911", model_slug: "911", vehicle_type: "Passenger Car", years: [2024], match_kind: "exact", id: "veh_395yw8tn73ff8", ids: { "2024": "veh_395yw8tn73ff8" } }],
          },
          request_id: "req_search",
        }),
      ],
      "search_vehicles",
      { query: "2024 porsche 911" }
    );
    expect((search.structured.data as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({ id: "veh_395yw8tn73ff8", ids: { "2024": "veh_395yw8tn73ff8" } });
    expect(search.summary).toMatch(/^1 catalog match for "2024 porsche 911"\./);
  });
});

/**
 * The step under an error is what the agent does next. A VIN NHTSA cannot
 * place needs the human, not the catalog step every other 404 carries (which
 * names decode_vin itself). The expected texts are word for word what the
 * hosted server answers for the same VIN (app/api/mcp/tools.test.ts).
 */
describe("stdio MCP error steps", () => {
  it("sends a VIN the API refused or could not place back to the human, not to the catalog or another decode_vin", async () => {
    const unknown = await callToolError(
      [problemResponse(404, "VIN not recognized", "NHTSA has no record of this VIN pattern. Check the characters, or send the full 17-character VIN.", "req_vin404")],
      "decode_vin",
      { vin: "00000000000000000" }
    );
    expect(unknown.text).toBe(`VIN not recognized: NHTSA has no record of this VIN pattern. Check the characters, or send the full 17-character VIN.\n${vinNextStepFor(404)}`);
    expect(unknown.text).not.toContain(nextStepFor(404));
    expect(unknown.structured).toMatchObject({ status: 404, request_id: "req_vin404" });

    const detail = '"1HGCI" is not a VIN: a VIN is 17 characters from A-Z (never I, O or Q) and 0-9; a partial VIN is at least 5 of them with * for each unknown position.';
    const refused = await callToolError([problemResponse(400, "Invalid VIN", detail, "req_vin400")], "decode_vin", { vin: "1HGCI" });
    expect(refused.text).toBe(`Invalid VIN: ${detail}\n${vinNextStepFor(400)}`);
    expect(refused.structured).toMatchObject({ status: 400, request_id: "req_vin400" });
  });

  it("keeps the catalog step for a vehicle 404", async () => {
    const missing = await callToolError(
      [problemResponse(404, "Vehicle not found", "porsche 912 2024 is not in the catalog.", "req_veh404")],
      "get_car_image",
      { make: "Porsche", model: "912", year: 2024 }
    );
    expect(missing.text).toBe(`Vehicle not found: porsche 912 2024 is not in the catalog.\n${nextStepFor(404)}`);
  });
});


describe("stdio make logo tool", () => {
  it("delivers an inline PNG for auto, preserves billing metadata and the trademark notice", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const payload = await toolCallPayload([new Response(new Uint8Array([137, 80, 78, 71]), { headers: {
      "Content-Type": "image/png", "X-Credits-Charged": "1", "X-Credits-Remaining": "99", "X-Request-Id": "logo_1",
    } })], "get_make_logo", { make: "Toyota", width: 256, trim: true, padding: 0, format: "auto" }, calls);
    expect(payload.error).toBeUndefined();
    expect(payload.result?.isError).not.toBe(true);
    expect(payload.result?.content[0]).toMatchObject({ type: "image", mimeType: "image/png", data: "iVBORw==" });
    expect(payload.result?.structuredContent).toMatchObject({ credits_charged: 1, credits_remaining: 99, request_id: "logo_1", notice: expect.stringContaining("no license is granted") });
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ make: "Toyota", w: "256", trim: "1", padding: "0", format: "png" });
  });

  it("returns an actionable 402 without retrying or purchasing", async () => {
    const result = await callToolError([problemResponse(402, "Insufficient credits", "No credits remaining", "logo_402")], "get_make_logo", { make: "toyota" });
    expect(result.structured.status).toBe(402);
    expect(result.text).toContain("credits are not sold");
    expect(result.text).toContain("Buy only when the human asks or a spending mandate they set covers it");
  });
});


it.each(["standard", "enhanced", "premium", null])("checks cached quality %s through GET only", async (quality) => {
  const cached = quality !== null;
  const view = { view: "side", cached, quality, paint_generation: cached ? 2 : null, upgradable: quality === "standard", upgrade_reason: quality === "standard" ? "quality" : null, upgrade_in_progress: false, render_eta: cached ? null : { typical_seconds: 15, slow_seconds: 25, samples: 20 }, upgrade_eta: null };
  const answer = { data: { object: "image_availability", vehicle: { id: "veh_78qtwrgh37bkr", make: "porsche", model: "911", year: 2024 }, color: "red", views: [view], summary: { cached: cached ? 1 : 0, high_quality: 0, upgradable: 0 }, latest_paint_generation: 2, estimates: {} }, request_id: "availability" };
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const payload = await toolCallPayload([Response.json(answer)], "get_image_availability", { vehicle: "veh_78qtwrgh37bkr", view: "side", color: "red" }, calls);
  expect(payload.result?.isError).not.toBe(true);
  expect(payload.result?.structuredContent).toMatchObject(answer);
  expect(calls).toEqual([{ url: "https://api.test/api/v1/images/availability?vehicle=veh_78qtwrgh37bkr&view=side&color=red", method: "GET", body: undefined, headers: expect.any(Headers) }]);
});
