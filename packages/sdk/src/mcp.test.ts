import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  API_REFERENCE,
  DEFAULT_MCP_TOOLSET,
  MCP_INSTRUCTIONS,
  MCP_INSTRUCTIONS_HEAD_LIMIT,
  MCP_TOOLS,
  MCP_TOOLSETS,
  MCP_UNLISTED_TOOLS,
  MCP_DOCUMENTED_EXTRAS,
  MCP_TOOLSET_NAMES,
  MCP_TOOL_LIST,
  MCP_TOOL_OUTPUT_SCHEMAS,
  MAX_MCP_CHECK_VEHICLES,
  MAX_MCP_TOOL_INPUT_ELEMENTS,
  accountSummary,
  checkSummary,
  formatApiReference,
  imageInputSchema,
  model3dSummary,
  imageUrlsSummary,
  withImageMarkdown,
  inlineImageFormat,
  jsonToolResult,
  MCP_TOOL_SCHEMAS,
  isMcpToolset,
  mcpInstructions,
  mcpInstructionsHead,
  nextStepFor,
  readTextArgument,
  readingTextArguments,
  resolveSummary,
  searchSummary,
  toImageOptions,
  toVehicleMatch,
  vinNextStepFor,
  type McpToolName,
} from "./mcp/index.js";
import { IDEMPOTENCY_KEY_PATTERN, MAX_CHECK_VIEWS_VEHICLES } from "./types.js";

describe("MCP tool definitions", () => {
  it("exposes all 42 tools with agent-grade descriptions", () => {
    expect(Object.keys(MCP_TOOLS).sort()).toEqual(
      [
        "create_car_image_urls",
        "describe_api",
        "get_pricing", "search_help", "create_checkout_link", "get_billing_link",
        "purchase_plan", "pay_invoice", "checkout_status", "list_members", "list_webhooks",
        "get_account",
        "get_car_image",
      "get_make_logo",
        "list_image_options",
        "report_image",
        "resolve_vehicle",
        "search_vehicles",
        "decode_vin",
        "check_vehicles",
      "get_image_availability",
        "create_3d_model",
        "get_3d_model",
        "publish_3d_model",
        "list_requests",
        "request_vehicle",
        "request_feature",
        "get_request",
        "upvote_request",
        "comment_on_request",
        "share_building",
        "share_referral",
        "report_issue",
        "upvote_feedback",
        "submit_review",
        "list_feedback",
        "get_feedback",
        "list_my_feedback",
        "remove_feedback_vote",
        "comment_on_feedback",
        "list_reviews",
      ].sort()
    );
    for (const tool of MCP_TOOL_LIST) {
      expect(tool.name).toBe(MCP_TOOLS[tool.name].name);
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.title.length).toBeGreaterThan(3);
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations.openWorldHint).toBe("boolean");
    }
    expect(MCP_TOOLS.get_car_image.annotations.readOnlyHint).toBe(false);
    expect(MCP_TOOLS.search_vehicles.annotations.readOnlyHint).toBe(true);
  });

  it("converts the image schema to JSON Schema with defaults, and no longer requires make/model/year", () => {
    const json = z.toJSONSchema(imageInputSchema, { io: "input" }) as { required?: string[]; properties: Record<string, Record<string, unknown>> };
    // A vehicle id replaces the three; the either/or rule is a refinement the
    // MCP server enforces when it parses, so none of the four is required here.
    expect(json.required ?? []).not.toEqual(expect.arrayContaining(["make"]));
    expect(Object.keys(json.properties)).toEqual(expect.arrayContaining(["vehicle", "make", "model", "year"]));
    expect(json.properties.vehicle?.pattern).toContain("veh_");
    expect(json.required ?? []).not.toContain("view");
    expect(json.properties.view?.default).toBe("front-3-4");
    // Color is any string (a preset or a hex); the presets are listed in the description.
    expect(json.properties.color?.type).toBe("string");
    expect(json.properties.color?.enum).toBeUndefined();
    expect(String(json.properties.color?.description)).toContain("burgundy");
    expect(String(json.properties.color?.description)).toContain("#1a2b3c");
    expect(json.properties.format?.default).toBe("png");
    // The car-image-urls skill teaches format "auto" for embeds; the tool must accept what the skill teaches.
    expect(json.properties.format?.enum).toEqual(["png", "webp", "jpg", "auto"]);
    // A size above 1024 is clamped by the server, so the schema does not refuse it; the description says so.
    expect(Number(json.properties.width?.maximum ?? Infinity)).toBeGreaterThan(1024);
    expect(String(json.properties.width?.description)).toContain("clamped");
    // framing is one single-typed enum, optional, with no default (a request without it is today's request).
    expect(json.properties.framing?.type).toBe("string");
    expect(json.properties.framing?.enum).toEqual(["consistent", "tight", "balanced"]);
    expect(json.properties.framing?.default).toBeUndefined();
    expect(json.required ?? []).not.toContain("framing");
    expect(String(json.properties.framing?.description)).toMatch(/never with them/);
  });

  it("reads report_image strictly, with one type per field", () => {
    const schema = MCP_TOOL_SCHEMAS.report_image;
    expect(schema.parse({ type: "missing_vehicle", make: "Rivian", model: "R3", year: "2026", external_ref: "meter-report-4813" })).toEqual({ type: "missing_vehicle", make: "Rivian", model: "R3", year: 2026, external_ref: "meter-report-4813" });
    expect(schema.parse({ request_id: "req_01JD7X2Q", category: "camera", reason: "wrong angle" }).category).toBe("camera");
    // A typo is refused, as the REST route refuses an unknown field, rather than dropped.
    expect(() => schema.parse({ request_id: "req_1", catgory: "paint" })).toThrow();
    expect(() => schema.parse({ type: "bogus" })).toThrow();
    expect(() => schema.parse({ request_id: "req_1", reason: "x".repeat(501) })).toThrow();
    expect(() => schema.parse({ request_id: "req_1", external_ref: "x".repeat(101) })).toThrow();
    expect(() => schema.parse({ asset_id: "not-a-uuid" })).toThrow();
    const json = z.toJSONSchema(schema, { io: "input" }) as { additionalProperties?: unknown; required?: string[]; properties: Record<string, Record<string, unknown>> };
    expect(json.additionalProperties).toBe(false);
    expect(json.required ?? []).toEqual([]);
    expect(json.properties.type?.enum).toEqual(["wrong_image", "poor_quality", "missing_vehicle"]);
    expect(json.properties.category?.enum).toEqual(["identity", "camera", "paint", "quality"]);
    expect(MCP_TOOLS.report_image.description).toMatch(/^Free\./);
    expect(MCP_TOOLS.report_image.description).toContain("report_issue");
    expect(MCP_TOOL_OUTPUT_SCHEMAS.report_image.parse({
      data: { object: "image_report", id: "r1", url: "https://carimage.dev/dashboard/image-reports/r1", type: "missing_vehicle", status: "reported", flagged: false, category: null, asset_id: null, vehicle: { make: "Rivian", model: "R3", year: 2026 }, report_count: 1, created_at: "2026-11-23T00:00:00Z", next_field: 1 },
      created: true,
      request_id: "req",
    }).created).toBe(true);
  });

  it("reads framing as one of its three values and nothing else", () => {
    const base = { make: "Porsche", model: "911", year: 2024 };
    expect(imageInputSchema.parse({ ...base, framing: "balanced" }).framing).toBe("balanced");
    expect(imageInputSchema.parse(base).framing).toBeUndefined();
    expect(() => imageInputSchema.parse({ ...base, framing: "cover" })).toThrow();
    expect(() => imageInputSchema.parse({ ...base, framing: 6 })).toThrow();
  });

  it("delivers png inline for auto, which only a signed URL can negotiate", () => {
    expect(inlineImageFormat("auto")).toBe("png");
    expect(inlineImageFormat("webp")).toBe("webp");
    expect(inlineImageFormat("jpg")).toBe("jpg");
  });

  it("takes an idempotency_key on create_car_image_urls in the header's own alphabet", () => {
    const schema = MCP_TOOL_SCHEMAS.create_car_image_urls;
    const images = [{ make: "Porsche", model: "911", year: 2024 }];
    expect(schema.parse({ images, idempotency_key: "listing-4711:v1" }).idempotency_key).toBe("listing-4711:v1");
    expect(schema.parse({ images }).idempotency_key).toBeUndefined();
    expect(() => schema.parse({ images, idempotency_key: "has spaces" })).toThrow();
    expect(() => schema.parse({ images, idempotency_key: "x".repeat(256) })).toThrow();
    expect(IDEMPOTENCY_KEY_PATTERN.test("order_42.a-b:c")).toBe(true);
  });

  it("applies defaults and coerces the year when parsing", () => {
    const parsed = imageInputSchema.parse({ make: "Porsche", model: "911", year: "2024" });
    expect(parsed).toMatchObject({ year: 2024, view: "front-3-4", color: "silver", format: "png" });
    expect(() => imageInputSchema.parse({ make: "Porsche", model: "911", year: 1900 })).toThrow();
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "navy" }).color).toBe("navy");
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "grey" }).color).toBe("grey");
    expect(() => imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "navyish" })).toThrow();
  });

  it("reads a number a host sent as text, and advertises the same schema as before", () => {
    // A host without a typed schema for the tool sends "960" for 960.
    const parsed = imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: "960", height: "600", padding: "8", trim: true });
    expect(parsed).toMatchObject({ width: 960, height: 600, padding: 8, trim: true });
    expect(MCP_TOOL_SCHEMAS.search_vehicles.parse({ query: "porsche 911", year: "2024", limit: "5" })).toEqual({ query: "porsche 911", year: 2024, limit: 5 });
    expect(MCP_TOOL_SCHEMAS.create_car_image_urls.parse({ images: [{ vehicle: "veh_395yw8tn73ff8" }], ttl_seconds: "604800", max_uses: "0", renew_days: "30" })).toMatchObject({ ttl_seconds: 604800, max_uses: 0, renew_days: 30 });
    expect(MCP_TOOL_SCHEMAS.list_requests.parse({ limit: "10" }).limit).toBe(10);
    // The bounds hold (a size above 1024 is the server's to clamp), and text that is not a number is still refused.
    expect(imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: "2000" }).width).toBe(2000);
    expect(() => imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: "0" })).toThrow();
    expect(() => imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: "wide" })).toThrow();
    expect(() => imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: "" })).toThrow();
    expect(() => imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", width: 600.5 })).toThrow();
    // A flag is a boolean: advertising a boolean-or-string type would break hosts that cannot express one.
    expect(() => imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8", trim: "true" })).toThrow();
    const json = z.toJSONSchema(imageInputSchema, { io: "input" }) as { properties: Record<string, Record<string, unknown>> };
    expect(json.properties.width).toMatchObject({ type: "integer", minimum: 1 });
    expect(json.properties.padding).toMatchObject({ type: "integer", minimum: 0, maximum: 50 });
    expect(json.properties.trim?.type).toBe("boolean");
    for (const tool of MCP_TOOL_LIST) {
      const schema = JSON.stringify(z.toJSONSchema(tool.inputSchema, { io: "input" }));
      expect(schema, `${tool.name} advertises a union type`).not.toMatch(/"type":\[/);
    }
  });

  it("bounds combined structured and text-decoded argument elements before schema validation", async () => {
    const schema = z.object({ values: z.array(z.unknown()) });
    const reader = readingTextArguments(schema)["~standard"];
    const atLimit = Array(MAX_MCP_TOOL_INPUT_ELEMENTS - 1).fill(0);
    expect((await reader.validate({ values: atLimit })).issues).toBeUndefined();
    expect((await reader.validate({ values: JSON.stringify(atLimit) })).issues).toBeUndefined();
    for (const values of [Array(MAX_MCP_TOOL_INPUT_ELEMENTS).fill(0), JSON.stringify(Array(MAX_MCP_TOOL_INPUT_ELEMENTS).fill(0))]) {
      expect(await reader.validate({ values })).toMatchObject({ issues: [{ message: expect.stringContaining("maximum of 10000 elements") }] });
    }
    const nested = readingTextArguments(z.object({ values: z.array(z.object({ values: z.array(z.number()) })) }))["~standard"];
    const half = JSON.stringify(Array(5_000).fill(0));
    expect(await nested.validate({ values: JSON.stringify([{ values: half }, { values: half }]) })).toMatchObject({ issues: [{ message: expect.stringContaining("maximum of 10000 elements") }] });
  });

  it("reads a flag, a list and a literal number a host sent as text, and advertises every schema unchanged", async () => {
    const target = { target: "draft-2020-12" } as const;
    for (const tool of MCP_TOOL_LIST) {
      const reader = readingTextArguments(tool.inputSchema);
      expect(reader["~standard"].jsonSchema.input(target), tool.name).toEqual(tool.inputSchema["~standard"].jsonSchema.input(target));
      expect(readingTextArguments(tool.inputSchema), tool.name).toBe(reader);
    }
    const read = async (name: McpToolName, args: unknown) => await readingTextArguments(MCP_TOOLS[name].inputSchema)["~standard"].validate(args);

    // What a host with no typed schema sent for a chat image: every argument as text, the list as its JSON.
    const minted = await read("create_car_image_urls", {
      images: '[{"vehicle": "veh_59854qbgfvar3", "view": "side", "color": "red", "width": 960, "height": 600, "trim": true, "padding": 8, "background": "#f4f4f4"}]',
      ttl_seconds: "604800",
      max_uses: "0",
      renew: "false",
    });
    expect(minted.issues).toBeUndefined();
    expect(minted).toMatchObject({
      value: {
        images: [{ vehicle: "veh_59854qbgfvar3", view: "side", color: "red", width: 960, height: 600, trim: true, padding: 8, background: "#f4f4f4" }],
        ttl_seconds: 604800,
        max_uses: 0,
        renew: false,
      },
    });
    // Text inside the list is read the same way, whether the list came as text or as a list.
    expect(await read("create_car_image_urls", { images: '[{"vehicle":"veh_59854qbgfvar3","trim":"true","width":"960"}]' })).toMatchObject({ value: { images: [{ trim: true, width: 960 }] } });
    expect(await read("create_car_image_urls", { images: [{ vehicle: "veh_59854qbgfvar3", trim: "TRUE" }] })).toMatchObject({ value: { images: [{ trim: true }] } });

    expect(await read("get_car_image", { vehicle: "veh_59854qbgfvar3", width: "960", height: "600", trim: "true", padding: "8" })).toMatchObject({ value: { width: 960, height: 600, trim: true, padding: 8 } });
    expect(await read("get_make_logo", { make: "toyota", width: "256", trim: " True " })).toMatchObject({ value: { width: 256, trim: true } });
    expect(await read("create_3d_model", { vehicle: "veh_59854qbgfvar3", publish: "true" })).toMatchObject({ value: { publish: true } });
    expect(await read("publish_3d_model", { id: "0b1e2f3a-4c5d-4e6f-8a9b-0c1d2e3f4a5b", unpublish: "false" })).toMatchObject({ value: { unpublish: false } });
    expect(await read("search_help", { query: "what does a 3D model cost", report_gap: "true" })).toMatchObject({ value: { report_gap: true } });
    expect(await read("create_checkout_link", { plan: "pro", interval: "year" })).toMatchObject({ value: { plan: "pro", interval: "year" } });

    // Typed arguments pass through as they are.
    expect(await read("create_car_image_urls", { images: [{ vehicle: "veh_59854qbgfvar3", trim: true }], renew: true, max_uses: 0 })).toMatchObject({ value: { images: [{ trim: true }], renew: true, max_uses: 0 } });
    // Text stays text where the schema asks for text.
    expect(await read("search_vehicles", { query: "2019" })).toMatchObject({ value: { query: "2019" } });
    expect(await read("resolve_vehicle", { query: "true" })).toMatchObject({ value: { query: "true" } });
    expect(await read("create_car_image_urls", { images: [{ vehicle: "veh_59854qbgfvar3" }], idempotency_key: "4711" })).toMatchObject({ value: { idempotency_key: "4711" } });
    expect(await read("request_feature", { title: "[interior views]", body: '{"views": "inside"}' })).toMatchObject({ value: { title: "[interior views]", body: '{"views": "inside"}' } });

    // What is not the advertised type is still refused, by the rule that refuses it.
    const refused = async (name: McpToolName, args: unknown) => JSON.stringify((await read(name, args)).issues ?? []);
    expect(await refused("get_car_image", { vehicle: "veh_59854qbgfvar3", trim: "yes" })).toContain("expected boolean");
    expect(await refused("create_car_image_urls", { images: "veh_59854qbgfvar3" })).toContain("expected array");
    expect(await refused("create_car_image_urls", { images: '[{"vehicle": "veh_59854qbgfvar3"' })).toContain("expected array");
    expect(await refused("create_car_image_urls", { images: "[]" })).toContain("Too small");
    // Credits are not sold: the tool takes a plan only.
    expect(await refused("create_checkout_link", { credits: "500" })).not.toBe("[]");
    expect(await refused("get_car_image", { vehicle: "veh_59854qbgfvar3", width: "0" })).toContain(">=1");
    expect(await refused("get_car_image", { make: "Porsche", model: "911" })).toContain("vehicle");
  });

  it("reads text only into the type the schema names", () => {
    expect(readTextArgument("true", { type: "boolean" })).toBe(true);
    expect(readTextArgument("False", { type: "boolean" })).toBe(false);
    expect(readTextArgument("1", { type: "boolean" })).toBe("1");
    expect(readTextArgument("960", { type: "integer" })).toBe(960);
    expect(readTextArgument("-0.5", { type: "number" })).toBe(-0.5);
    expect(readTextArgument("wide", { type: "integer" })).toBe("wide");
    expect(readTextArgument("", { type: "integer" })).toBe("");
    expect(readTextArgument("960", { type: "string" })).toBe("960");
    expect(readTextArgument("[1, 2]", { type: "string" })).toBe("[1, 2]");
    expect(readTextArgument('["1", "2"]', { type: "array", items: { type: "integer" } })).toEqual([1, 2]);
    expect(readTextArgument('{"a": "true", "b": "x"}', { type: "object", properties: { a: { type: "boolean" } } })).toEqual({ a: true, b: "x" });
    expect(readTextArgument('{"a": 1}', { type: "array" })).toBe('{"a": 1}');
    expect(readTextArgument("[1", { type: "array" })).toBe("[1");
    expect(readTextArgument("500", { anyOf: [{ type: "number" }, { type: "string" }] })).toBe(500);
    expect(readTextArgument("abc", { anyOf: [{ type: "number" }, { type: "string" }] })).toBe("abc");
    expect(readTextArgument("true", undefined)).toBe("true");
    expect(readTextArgument(true, { type: "boolean" })).toBe(true);
    expect(readTextArgument(null, { type: "object", properties: {} })).toBeNull();
  });

  it("accepts a vehicle id in place of make, model and year, and hex paint as a color", () => {
    expect(imageInputSchema.parse({ vehicle: "veh_395yw8tn73ff8" })).toMatchObject({ vehicle: "veh_395yw8tn73ff8", view: "front-3-4", color: "silver" });
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "#1a2b3c" }).color).toBe("#1a2b3c");
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "1A2B3C" }).color).toBe("1A2B3C");
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "#abc" }).color).toBe("#abc");
    expect(imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "Red" }).color).toBe("Red");
    // Neither a vehicle id nor all three of make, model and year: rejected before any executor runs.
    expect(() => imageInputSchema.parse({ make: "Porsche", model: "911" })).toThrow(/vehicle/);
    expect(() => imageInputSchema.parse({})).toThrow(/vehicle/);
    expect(() => imageInputSchema.parse({ vehicle: "veh_nope" })).toThrow();
    expect(() => imageInputSchema.parse({ make: "Porsche", model: "911", year: 2024, color: "#12345" })).toThrow(/hex/);
    // The same rules on the other tools that name a vehicle.
    expect(MCP_TOOLS.create_3d_model.inputSchema.parse({ vehicle: "veh_395yw8tn73ff8", color: "1a2b3c" })).toMatchObject({ color: "1a2b3c" });
    expect(() => MCP_TOOLS.create_3d_model.inputSchema.parse({ make: "Toyota", model: "Camry" })).toThrow(/vehicle/);
    expect(() => MCP_TOOLS.create_3d_model.inputSchema.parse({ vehicle: "veh_395yw8tn73ff8", idempotency_key: "bad key!" })).toThrow();
    expect(MCP_TOOLS.decode_vin.inputSchema.parse({ vin: "1HGCM826*3A", year: "2003" })).toEqual({ vin: "1HGCM826*3A", year: 2003 });
  });

  it("names only what is free in the instructions and get_account", () => {
    // App directory reviews hold back a server whose instructions or account tool talk money.
    expect(MCP_INSTRUCTIONS).toContain("A new account includes 30 free vehicle images in total");
    expect(MCP_INSTRUCTIONS).toContain("30 more as a one-time courtesy after those run out");
    for (const toolset of MCP_TOOLSET_NAMES) {
      const head = mcpInstructionsHead(toolset);
      expect(head, toolset).not.toMatch(/credit|\$|dollar|price|purchase|buy|checkout|plan\b|spend|cost|charg|token/i);
    }
    expect(MCP_INSTRUCTIONS).not.toMatch(/credit|\$|dollar|price|purchase|buy|checkout|plan\b|spend|cost|charg|token/i);
    expect(MCP_TOOLS.get_account.title).toBe("Get account");
    expect(MCP_TOOLS.get_account.description).toMatch(/^Free\./);
    expect(MCP_TOOLS.get_account.description).toContain("30 free vehicle images, once per account");
    expect(MCP_TOOLS.get_account.description).not.toMatch(/credit|\$|dollar|price|purchase|buy|checkout|plan\b|spend|cost|charg|token|payment/i);
    expect(MCP_INSTRUCTIONS).toMatch(/never place the API key in URLs/i);
    expect(MCP_INSTRUCTIONS).toContain("tell the human the catalog does not carry it and stop");
    // A 3D model is a hundred times an image; the agent is told to ask first.
    expect(MCP_INSTRUCTIONS).toContain("Confirm with the human before calling create_3d_model.");
    expect(MCP_INSTRUCTIONS).toContain("decode_vin");
    expect(MCP_TOOLS.create_3d_model.description).toMatch(/^COSTS 100 credits PER CALL/);
    expect(MCP_TOOLS.create_3d_model.description).toMatch(/confirm with the human/);
    expect(MCP_TOOLS.decode_vin.description).toMatch(/^Free\./);
    expect(MCP_TOOLS.get_3d_model.description).toMatch(/^Free\./);
  });

  it("puts what an agent must know where every host shows it", () => {
    // Claude's hosts pass a model the first 2,048 characters of these
    // instructions and nothing after them.
    expect(MCP_INSTRUCTIONS_HEAD_LIMIT).toBe(2048);
    for (const toolset of MCP_TOOLSET_NAMES) {
      const head = mcpInstructionsHead(toolset);
      expect(mcpInstructions(toolset).startsWith(head), toolset).toBe(true);
      // Bytes, not characters: whichever a host counts, the head fits.
      expect(new TextEncoder().encode(head).length, toolset).toBeLessThanOrEqual(MCP_INSTRUCTIONS_HEAD_LIMIT);
      const shown = mcpInstructions(toolset).slice(0, MCP_INSTRUCTIONS_HEAD_LIMIT);
      // The two calls, in order, and the id that joins them.
      expect(shown.indexOf("resolve_vehicle"), toolset).toBeGreaterThan(-1);
      expect(shown.indexOf("resolve_vehicle"), toolset).toBeLessThan(shown.indexOf("get_car_image"));
      expect(shown, toolset).toMatch(/First look the vehicle up/);
      // ChatGPT uses the card attached to signed URLs; other hosts retain their display workflow.
      expect(shown, toolset).toContain("In ChatGPT, create_car_image_urls shows the image card.");
      expect(shown, toolset).toContain("ttl_seconds: 604800, max_uses: 0 and renew: false");
      expect(shown, toolset).toContain("Use signed URLs for pages, apps, emails and documents, or when the host cannot display image bytes.");
      expect(shown, toolset).toContain("get_image_availability to check prepared views and quality without rendering");
      expect(shown, toolset).toContain("resolve_vehicle, search_vehicles or decode_vin");
      // When to ask, what it costs, and when to stop.
      expect(shown, toolset).toMatch(/confidence is low or the year differs, ask the user before proceeding/);
      expect(shown, toolset).toMatch(/Never substitute another vehicle/);
      expect(shown, toolset).toContain("30 free vehicle images in total");
      if ((MCP_TOOLSETS[toolset] as readonly string[]).includes("create_3d_model")) {
        expect(shown, toolset).toContain("Confirm with the human before calling create_3d_model.");
      } else {
        // A cost rule for a tool the host cannot call is noise in the space every host shows.
        expect(shown, toolset).not.toContain("create_3d_model");
      }
      expect(shown, toolset).toContain("On HTTP 402, stop and share any link in the response.");
    }
    // The request board is served on `all` but out of the reference: no toolset's head steers an agent to it.
    for (const toolset of MCP_TOOLSET_NAMES) {
      expect(mcpInstructionsHead(toolset)).toContain("tell the human the catalog does not carry it and stop");
      expect(mcpInstructionsHead(toolset)).not.toContain("/requests");
      expect(mcpInstructionsHead(toolset)).not.toContain("request_vehicle");
    }
    expect(mcpInstructionsHead()).toBe(mcpInstructionsHead("core"));
  });

  it("tells an agent to look a vehicle up before every tool that names one", () => {
    expect(MCP_TOOLS.get_car_image.description).toMatch(/COSTS 1 CREDIT per call/);
    expect(MCP_TOOLS.get_car_image.description).toMatch(/Call resolve_vehicle first .* pass the id it returns as `vehicle`/);
    expect(MCP_TOOLS.resolve_vehicle.description).toMatch(/^Free\. The first call for any picture of a car, including one you chose yourself/);
    expect(MCP_TOOLS.resolve_vehicle.description).toContain("Pass params.vehicle_id as vehicle");
    expect(MCP_TOOLS.create_car_image_urls.description).toMatch(/look each distinct vehicle up once/);
    expect(MCP_TOOLS.create_3d_model.description).toMatch(/its vehicle id from resolve_vehicle, search_vehicles or decode_vin/);
    const json = z.toJSONSchema(imageInputSchema, { io: "input" }) as { properties: Record<string, { description?: string }> };
    expect(json.properties.vehicle?.description).toMatch(/The preferred way to name a vehicle/);
    expect(json.properties.model?.description).toMatch(/rather than typing it from memory/);
    // Hosts cut a long description too; none comes near the limit.
    for (const tool of MCP_TOOL_LIST) expect(tool.description.length, tool.name).toBeLessThan(MCP_INSTRUCTIONS_HEAD_LIMIT);
  });

  it("checks a list with loose entries, capped for a model's context, and says what to do with each answer", async () => {
    const schema = MCP_TOOL_SCHEMAS.check_vehicles;
    // A bad row is the server's to answer as invalid, not a reason to refuse the list.
    const parsed = schema.parse({ vehicles: [{ make: "Mazda", model: "MX-5 Miata", year: "2018", ref: 7, view: "side" }, {}, { vehicle: "f150" }] });
    expect(parsed.vehicles).toEqual([{ make: "Mazda", model: "MX-5 Miata", year: 2018, ref: "7" }, {}, { vehicle: "f150" }]);
    expect(MAX_MCP_CHECK_VEHICLES).toBe(100);
    expect(schema.safeParse({ vehicles: Array.from({ length: 101 }, () => ({ vehicle: "veh_395yw8tn73ff8" })) }).success).toBe(false);
    expect(schema.safeParse({ vehicles: [] }).success).toBe(false);
    // A text-only host sends the list as JSON text.
    const read = await readingTextArguments(schema)["~standard"].validate({ vehicles: JSON.stringify([{ make: "Kia", model: "EV6", year: 2024 }]) });
    expect(read).toEqual({ value: { vehicles: [{ make: "Kia", model: "EV6", year: 2024 }] } });
    expect(MCP_TOOLS.check_vehicles.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(MCP_TOOLS.check_vehicles.description).toContain("Free.");
    expect(checkSummary({ total: 3, match: 3, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 2 })).toBe(
      "Checked 3 vehicles: 3 matches, 0 suggestions, 0 misses. Render each match by its vehicle.id (2 distinct vehicles)."
    );
    expect(checkSummary({ total: 1, match: 0, suggestion: 1, miss: 0, invalid: 0, distinct_vehicles: 0 })).toBe(
      "Checked 1 vehicle: 0 matches, 1 suggestion, 0 misses. Each suggestion names other vehicles than the one listed: ask the human before using one."
    );
    // A miss names the requests page (BL-067: 0 of 13 accounts whose checks missed requested a vehicle while the tool said only "skip").
    expect(checkSummary({ total: 2, match: 1, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 1 })).toBe(
      "Checked 2 vehicles: 1 match, 0 suggestions, 1 miss. Render each match by its vehicle.id (1 distinct vehicle). Skip each miss in every view and color; the human can request a missing vehicle at https://carimage.dev/requests?ref=mcp and gets an email when it is added."
    );
    expect(checkSummary({ total: 1, match: 0, suggestion: 0, miss: 1, invalid: 0, distinct_vehicles: 0 }, "https://preview.example")).toContain(
      "request a missing vehicle at https://preview.example/requests?ref=mcp"
    );
    // views: a switch, read from text like any argument; one MCP call stays within a REST check that reads views.
    expect(schema.parse({ vehicles: [{ vehicle: "veh_395yw8tn73ff8" }], views: true }).views).toBe(true);
    expect(schema.safeParse({ vehicles: [{ vehicle: "veh_395yw8tn73ff8" }], views: "front" }).success).toBe(false);
    expect(await readingTextArguments(schema)["~standard"].validate({ vehicles: JSON.stringify([{ vehicle: "veh_395yw8tn73ff8" }]), views: "true" })).toEqual({
      value: { vehicles: [{ vehicle: "veh_395yw8tn73ff8" }], views: true },
    });
    expect(MAX_MCP_CHECK_VEHICLES).toBeLessThanOrEqual(MAX_CHECK_VIEWS_VEHICLES);
    expect(checkSummary({ total: 3, match: 3, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 2, views_complete: 1 })).toBe(
      "Checked 3 vehicles: 3 matches, 0 suggestions, 0 misses. Render each match by its vehicle.id (2 distinct vehicles). 1 of 2 have all nine views prepared; views.missing names the views of the others that are not prepared yet."
    );
    // Verification is mentioned only when a vehicle has every prepared view verified; 0 says nothing.
    expect(checkSummary({ total: 3, match: 3, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 2, views_complete: 1, views_verified: 0 })).not.toContain("verified");
    expect(checkSummary({ total: 3, match: 3, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 2, views_complete: 1, views_verified: 1 })).toContain(
      "1 vehicle has every prepared view verified; views.verified names each match's verified views."
    );
    for (const toolset of MCP_TOOLSET_NAMES) expect(mcpInstructionsHead(toolset)).toContain("Use check_vehicles for up to 100 vehicles at once");
    expect(formatApiReference("vehicles/check")).toContain("POST /api/v1/vehicles/check");
  });

  it("splits the tools into a focused core set and an opt-in full set", () => {
    expect(DEFAULT_MCP_TOOLSET).toBe("core");
    // Look the vehicle up, render it, watch the balance (the 2026-09-29 audit's default), plus the fleet's four feedback tools.
    expect([...MCP_TOOLSETS.core]).toEqual([
      "resolve_vehicle",
      "search_vehicles",
      "decode_vin",
      "check_vehicles",
      "get_image_availability",
      "get_car_image",
      "create_car_image_urls",
      "get_account",
      "request_feature",
      "report_issue",
      "upvote_feedback",
      "submit_review",
    ]);
    expect([...MCP_TOOLSETS.all].sort()).toEqual(Object.keys(MCP_TOOLS).sort());
    // tools/list order is what a host shows: the core tools come first on `all` too.
    expect([...MCP_TOOLSETS.all].slice(0, MCP_TOOLSETS.core.length)).toEqual([...MCP_TOOLSETS.core]);
    for (const name of MCP_TOOLSETS.core) expect(MCP_TOOLSETS.all).toContain(name);
    expect(isMcpToolset("core") && isMcpToolset("all")).toBe(true);
    expect(isMcpToolset("everything")).toBe(false);
    // Served but out of the public reference: on `all`, never on `core`, all real tools.
    for (const name of MCP_UNLISTED_TOOLS) {
      expect(MCP_TOOLSETS.all).toContain(name);
      expect(MCP_TOOLSETS.core).not.toContain(name);
      expect(Object.keys(MCP_TOOLS)).toContain(name);
    }
    expect([...MCP_DOCUMENTED_EXTRAS]).toEqual([
      "report_image",
      "list_feedback",
      "get_feedback",
      "list_my_feedback",
      "remove_feedback_vote",
      "comment_on_feedback",
      "list_reviews",
      "get_make_logo",
      "create_3d_model",
      "get_3d_model",
      "publish_3d_model",
      "list_image_options",
      "describe_api",
      "get_pricing",
      "search_help",
      "create_checkout_link",
      "get_billing_link",
      "purchase_plan",
      "pay_invoice",
      "checkout_status",
      "list_members",
      "list_webhooks",
    ]);
    // A toolset's instructions never name a tool its server does not have.
    for (const toolset of MCP_TOOLSET_NAMES) {
      const instructions = mcpInstructions(toolset);
      for (const name of MCP_TOOLSETS.all.filter((tool) => !(MCP_TOOLSETS[toolset] as readonly string[]).includes(tool))) {
        expect(instructions, toolset).not.toContain(name);
      }
    }
    const core = mcpInstructions("core");
    expect(core).not.toContain("/requests");
    expect(core).not.toContain("Quality:");
    const all = mcpInstructions("all");
    // Served but unlisted tools get no paragraph of their own on any toolset; their descriptions suffice.
    for (const name of MCP_UNLISTED_TOOLS) expect(all).not.toContain(name);
    expect(all).toContain("Confirm with the human before calling create_3d_model.");
    expect(MCP_TOOLS.publish_3d_model.annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.remove_feedback_vote.annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.share_building.annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.share_referral.annotations.destructiveHint).toBe(true);
    expect(all).toBe(MCP_INSTRUCTIONS);
  });

  it("describes the delivery options and the real confidence scale", () => {
    const json = z.toJSONSchema(imageInputSchema, { io: "input" }) as { properties: Record<string, Record<string, unknown>> };
    expect(json.properties.fit?.enum).toEqual(["contain", "cover", "inside"]);
    expect(json.properties.padding?.maximum).toBe(50);
    expect(json.properties.trim?.type).toBe("boolean");
    expect(MCP_TOOLS.resolve_vehicle.description).toMatch(/high, medium or low/);
    expect(MCP_TOOLS.resolve_vehicle.description).not.toMatch(/0-1/);
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.resolve_vehicle.parse({ data: { params: { make: "a", model: "b", year: 2020, view: "side", color: "red" }, candidates: [], confidence: 0.9 }, cli: "x" })).toThrow();
    const urls = API_REFERENCE.find((endpoint) => endpoint.path === "/api/v1/image-urls");
    expect(urls?.params?.join(" ")).toContain("size?");
    expect(urls?.params?.join(" ")).toContain("Idempotency-Key");
    const image = API_REFERENCE.find((endpoint) => endpoint.path === "/api/v1/images/car");
    expect(image?.params?.join(" ")).toMatch(/fit \(contain\|cover\|inside/);
  });

  it("keeps the served-but-unlisted endpoints out of the compact reference", () => {
    // Image feedback, the request board and the about-you endpoints still answer; the
    // reference an agent reads no longer teaches them (the 2026-09-30 surface audit).
    for (const endpoint of API_REFERENCE) {
      expect(endpoint.path).not.toBe("/api/v1/feedback");
      expect(endpoint.path.startsWith("/api/v1/requests")).toBe(false);
      expect(endpoint.path.startsWith("/api/v1/account/")).toBe(false);
    }
    for (const needle of ["/api/v1/feedback", "/api/v1/requests", "/api/v1/account/building", "/api/v1/account/referral"]) {
      expect(formatApiReference(needle)).toContain("No endpoint matches");
    }
    expect(formatApiReference("/api/v1/account")).toContain("car-image whoami");
  });

  it("documents vehicle ids, hex paint, VIN decoding and the 3D endpoints", () => {
    const paths = API_REFERENCE.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(paths).toEqual(
      expect.arrayContaining(["GET /api/v1/vehicles/{id}", "GET /api/v1/vin/{vin}", "POST /api/v1/3d", "GET /api/v1/3d", "GET /api/v1/3d/{id}", "GET /api/v1/3d/{id}/files/{kind}"])
    );
    const image = API_REFERENCE.find((endpoint) => endpoint.path === "/api/v1/images/car");
    expect(image?.params?.join(" ")).toMatch(/vehicle \(a stable vehicle id/);
    expect(image?.params?.join(" ")).toMatch(/any hex paint written bare in URLs such as 1a2b3c/);
    const model = API_REFERENCE.find((endpoint) => endpoint.method === "POST" && endpoint.path === "/api/v1/3d");
    expect(model?.credits).toContain("100 credits per model");
    expect(model?.sdk).toContain("client.create3dModel(");
    expect(model?.cli).toContain("car-image 3d create");
    const files = API_REFERENCE.find((endpoint) => endpoint.path === "/api/v1/3d/{id}/files/{kind}");
    expect(files?.notes).toMatch(/without the Authorization header/);
    expect(formatApiReference("vin")).toContain("car-image vin");
    expect(formatApiReference()).toContain("Vehicles: make + model + year, or vehicle=");
  });

  it("formats and filters the compact API reference", () => {
    expect(API_REFERENCE.some((endpoint) => endpoint.path === "/api/v1/images/car")).toBe(true);
    const all = formatApiReference();
    expect(all).toContain("GET /api/v1/images/car");
    expect(all).toContain("POST /api/v1/image-urls");
    const filtered = formatApiReference("image-urls");
    expect(filtered).toContain("POST /api/v1/image-urls");
    expect(filtered).not.toContain("GET /api/v1/account");
    expect(formatApiReference("nothing-here")).toContain("No endpoint matches");
  });
});

describe("MCP tool output schemas", () => {
  it("promises structured content for every tool whose result is data", () => {
    const missing = MCP_TOOL_LIST.filter((tool) => !tool.outputSchema).map((tool) => tool.name);
    // describe_api answers with the reference prose itself; structured content
    // would restate it and double the tokens of every call.
    expect(missing).toEqual(["describe_api"]);
    for (const [name, schema] of Object.entries(MCP_TOOL_OUTPUT_SCHEMAS)) {
      const json = z.toJSONSchema(schema, { io: "output" }) as { type?: string; additionalProperties?: unknown };
      expect(json.type, name).toBe("object");
      // These payloads are the REST API's and gain fields as it grows, so a
      // client that validates must not reject a response for being newer.
      expect(json.additionalProperties, name).not.toBe(false);
    }
  });

  it("accepts what the servers actually send, and rejects a payload that drifts", () => {
    const usage = {
      credits_charged: 1,
      credits_remaining: 99,
      source: "cache",
      width: 1024,
      height: 1024,
      content_type: "image/png",
      etag: '"abc"',
      request_id: "req_1",
      vehicle: { vehicle_id: "veh_395yw8tn73ff8", make: "Porsche", model: "911", year: 2024, view: "side", color: "red", format: "png" },
    };
    expect(MCP_TOOL_OUTPUT_SCHEMAS.get_car_image.parse(usage)).toMatchObject({ source: "cache" });
    // The stdio server has no width header to report on some responses.
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.get_car_image.parse({ ...usage, width: null, etag: null })).not.toThrow();
    // A hex paint is echoed as #rrggbb; the catalog may not name a vehicle id.
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.get_car_image.parse({ ...usage, vehicle: { ...usage.vehicle, vehicle_id: null, color: "#1a2b3c" } })).not.toThrow();
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.get_car_image.parse({ ...usage, vehicle: { ...usage.vehicle, view: "birds-eye" } })).toThrow();
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.get_car_image.parse({ ...usage, credits_charged: "one" })).toThrow();
    expect(() =>
      MCP_TOOL_OUTPUT_SCHEMAS.resolve_vehicle.parse({
        data: { params: { vehicle_id: null, make: "a", model: "b", year: 2020, view: "side", color: "1a2b3c" }, candidates: [], confidence: "high" },
        cli: "x",
      })
    ).not.toThrow();
  });

  it("accepts the VIN and 3D payloads the servers send", () => {
    const vin = {
      data: {
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
      },
      request_id: "req_vin",
    };
    expect(MCP_TOOL_OUTPUT_SCHEMAS.decode_vin.parse(vin).data.vehicle?.id).toBe("veh_395yw8tn73ff8");
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.decode_vin.parse({ ...vin, data: { ...vin.data, vehicle: null, source: "guesswork" } })).toThrow();

    const model = {
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
    const created = { data: model, billing: { charged_on: "creation", credits_charged: 1000, credits_remaining: 4000, already_owned: false }, request_id: "req_3d" };
    expect(MCP_TOOL_OUTPUT_SCHEMAS.create_3d_model.parse(created).billing.credits_charged).toBe(1000);
    const ready = {
      ...model,
      status: "ready",
      progress: 100,
      stage: "done",
      files: { glb: { url: "https://carimage.dev/api/v1/3d/2222/files/glb", bytes: 6409636, content_type: "model/gltf-binary" } },
      polycount: 60000,
      estimated_seconds_remaining: null,
      ready_at: "2026-09-16T02:16:05.000Z",
    };
    expect(MCP_TOOL_OUTPUT_SCHEMAS.get_3d_model.parse({ data: ready, request_id: "r" }).data.files?.glb?.bytes).toBe(6409636);
    expect(() => MCP_TOOL_OUTPUT_SCHEMAS.get_3d_model.parse({ data: { ...ready, status: "done" }, request_id: "r" })).toThrow();
  });

  it("normalizes a catalog hit from either server onto one spelling", () => {
    const fromCatalog = toVehicleMatch({ kind: "model", makeName: "Porsche", makeSlug: "porsche", modelName: "911", modelSlug: "911", vehicleType: "Passenger Car", years: [2024], matchKind: "exact" });
    const fromRest = toVehicleMatch({ kind: "model", make_name: "Porsche", make_slug: "porsche", model_name: "911", model_slug: "911", vehicle_type: "Passenger Car", years: [2024], match_kind: "exact" });
    expect(fromCatalog).toEqual(fromRest);
    expect(fromCatalog).toMatchObject({ make: "Porsche", model: "911" });
    // A make hit carries no model on either side; the schema promises a null.
    expect(toVehicleMatch({ kind: "make", makeName: "Porsche", makeSlug: "porsche", years: [2024] })).toMatchObject({ model: null, model_slug: null, vehicle_type: null, match_kind: null });
  });

  it("normalizes the options payload from either server, and leaves extras alone", () => {
    const flat = { formats: ["png", "webp"], catalog: { makes: 2, models: 3, years: [1990, 2027], sources: ["nhtsa-cvs"] } };
    const rest = {
      formats: [{ id: "png", mime: "image/png" }, { id: "webp", mime: "image/webp" }],
      catalog: { makes: 2, models: 3, years: { from: 1990, to: 2027 }, sources: [{ id: "nhtsa-cvs", name: "NHTSA" }] },
      limits: { max_batch_urls: 50 },
    };
    expect(toImageOptions(flat)).toMatchObject({ formats: ["png", "webp"], catalog: { years: [1990, 2027], sources: ["nhtsa-cvs"] } });
    expect(toImageOptions(rest)).toMatchObject({ formats: ["png", "webp"], catalog: { years: [1990, 2027], sources: ["nhtsa-cvs"] }, limits: { max_batch_urls: 50 } });
  });
});

/**
 * The one-line summary above a result is what an agent reads first, and some
 * of it is a stop sign: a low balance, a low-confidence match. Both servers
 * build it here from the payload they already share, so the hosted server and
 * `car-image mcp` cannot tell an agent different things about the same call.
 */
describe("MCP summaries both servers share", () => {
  const plan = { name: "Pro", limits: { vehicles_per_month: 2500 } };

  it("names the balance in dollars, the plan and its vehicle cap, and stops the agent when the balance is low", () => {
    expect(accountSummary({ credits: 1234, plan, pricing: { credits_per_image: 1, credits_per_dollar: 100 } })).toBe(
      "1,234 credits ≈ $12.34 (1 credit per image) on the Pro plan, up to 2,500 distinct vehicles a month."
    );
    // No cap (Enterprise, grandfathered accounts) and no plan (an older server) both read cleanly.
    expect(accountSummary({ credits: 500, plan: { name: "Enterprise", limits: { vehicles_per_month: null } } })).toBe("500 credits ≈ $5.00 (1 credit per image) on the Enterprise plan.");
    expect(accountSummary({ credits: 500 })).toBe("500 credits ≈ $5.00 (1 credit per image).");
    expect(accountSummary({ credits: 9, plan })).toContain("Balance is low: ask the human before rendering more.");
    expect(accountSummary({ credits: 10, plan })).not.toContain("Balance is low");
  });

  it("resolves to the display names and asks for confirmation before a low-confidence charge", () => {
    const data = { params: { make: "porsche", model: "911", year: 2024, view: "side", color: "red" }, display: { make_name: "Porsche", model_name: "911" }, confidence: "high" };
    expect(resolveSummary(data)).toBe("Resolved to Porsche 911 2024, view side, color red (confidence high).");
    expect(resolveSummary({ ...data, display: null })).toContain("Resolved to porsche 911 2024");
    expect(resolveSummary({ ...data, confidence: "low" })).toContain("Confidence is low: confirm with the human before making an image.");
  });

  it("hands over the call that renders a resolved vehicle, by its id", () => {
    const data = {
      params: { vehicle_id: "veh_59854qbgfvar3", make: "mazda", model: "mx-5", year: 2018, view: "front-3-4", color: "red" },
      display: { make_name: "MAZDA", model_name: "MX-5" },
      confidence: "high",
      extracted: { year: 2018 },
    };
    const render = 'how it with get_car_image (in chat; create_car_image_urls for a page, app, email or document, or in a terminal), passing vehicle: "veh_59854qbgfvar3", view: "front-3-4" and color: "red".';
    expect(resolveSummary(data)).toBe(`Resolved to MAZDA MX-5 2018, view front-3-4, color red (confidence high). S${render}`);
    // A phrase that named no year resolved to the latest one: nothing to ask about.
    expect(resolveSummary({ ...data, extracted: { year: null } })).toBe(resolveSummary(data));
    // What needs the human comes before the call, and the call waits for them.
    expect(resolveSummary({ ...data, confidence: "low" })).toBe(
      `Resolved to MAZDA MX-5 2018, view front-3-4, color red (confidence low). Confidence is low: confirm with the human before making an image. Once they agree, s${render}`
    );
  });

  it("says so when the vehicle resolved to another year than the one asked for", () => {
    const summary = resolveSummary({
      params: { vehicle_id: "veh_czf991zr6an6z", make: "subaru", model: "wrx-sti", year: 2017, view: "front-3-4", color: "silver" },
      display: { make_name: "SUBARU", model_name: "WRX STI" },
      confidence: "medium",
      extracted: { year: 2020 },
    });
    expect(summary).toBe(
      'Resolved to SUBARU WRX STI 2017, view front-3-4, color silver (confidence medium). The human asked for 2020: no 2020 WRX STI is in the catalog, so this is the 2017. Do not render it yet. That year may file the car under another name: try search_vehicles with the make, the model family and year 2020, then tell the human what you found and ask. Once they agree, show it with get_car_image (in chat; create_car_image_urls for a page, app, email or document, or in a terminal), passing vehicle: "veh_czf991zr6an6z", view: "front-3-4" and color: "silver".'
    );
  });

  it("carries the summary in the structured result too, for hosts that show a model nothing else", () => {
    const result = jsonToolResult({ data: { ok: true }, request_id: "req_1" }, "Resolved to MAZDA MX-5 2018.");
    expect(result.structuredContent).toEqual({ summary: "Resolved to MAZDA MX-5 2018.", data: { ok: true }, request_id: "req_1" });
    expect(Object.keys(result.structuredContent ?? {})[0]).toBe("summary");
    expect(result.content[0]).toEqual({ type: "text", text: 'Resolved to MAZDA MX-5 2018.\n\n{\n  "data": {\n    "ok": true\n  },\n  "request_id": "req_1"\n}' });
    // No summary, nothing added; a payload's own summary is the payload's.
    expect(jsonToolResult({ data: 1 }).structuredContent).toEqual({ data: 1 });
    expect(jsonToolResult({ summary: "theirs" }, "ours").structuredContent).toEqual({ summary: "theirs" });
    // Every advertised output schema accepts it: they are loose objects.
    expect(() =>
      MCP_TOOL_OUTPUT_SCHEMAS.resolve_vehicle.parse(
        jsonToolResult(
          { data: { params: { vehicle_id: "veh_59854qbgfvar3", make: "mazda", model: "mx-5", year: 2018, view: "side", color: "red" }, candidates: [], confidence: "high" }, cli: "car-image get" },
          "Resolved."
        ).structuredContent
      )
    ).not.toThrow();
  });

  it("points a search at the vehicle ids, and keeps an empty search from reading as a missing vehicle", () => {
    expect(searchSummary("porsche 911", 1)).toMatch(/^1 catalog match for "porsche 911"\. .*vehicle id/);
    expect(searchSummary("911", 3)).toMatch(/^3 catalog matches/);
    expect(searchSummary("911", 3)).toContain("as vehicle to get_car_image, create_car_image_urls or create_3d_model");
    expect(searchSummary("zzz", 0)).toBe(
      'No catalog match for "zzz". That is not yet a missing vehicle: try resolve_vehicle with the year, make and model, fewer words, or the manufacturer alone.'
    );
  });

  it("says what minted URLs cost and until when they serve, the first time and on a replay", () => {
    const minted = { data: [{ expires_at: "2026-09-23T12:00:00.000Z", renews_until: null }, { expires_at: "2026-09-23T12:00:00.000Z", renews_until: null }], billing: { credits_charged: 2, credits_remaining: 98 } };
    expect(imageUrlsSummary(minted)).toContain(
      "Created 2 signed URLs; charged 2 credits, 98 remaining."
    );
    const replay = imageUrlsSummary({ ...minted, idempotent_replayed: true });
    expect(replay).toContain("Replayed the result stored for this idempotency_key: 2 signed URLs, charged 2 credits the first time and nothing now.");
    expect(replay).toContain("they expire at 2026-09-23T12:00:00.000Z");
    const renewing = imageUrlsSummary({ data: [{ expires_at: "2026-09-30T12:00:00.000Z", renews_until: "2027-09-23T12:00:00.000Z" }], billing: { credits_charged: 1, credits_remaining: 0 } });
    expect(renewing).toContain("charged 1 credit, 0 remaining");
    expect(renewing).toContain("and renew on load, one credit per window, until 2027-09-23T12:00:00.000Z.");
  });
});

describe("MCP next steps both servers append to an error", () => {
  it("sends a refused or unknown VIN back to the human, never to the catalog or another decode", () => {
    const unknown = vinNextStepFor(404);
    expect(unknown).not.toBe(nextStepFor(404));
    expect(unknown).not.toContain("decode_vin");
    expect(unknown).toContain("first three characters (the maker code)");
    expect(unknown).toContain("partial VIN with * for each unknown position and a year hint");
    expect(unknown).toContain("vehicles made for the US market");
    const refused = vinNextStepFor(400);
    expect(refused).not.toBe(nextStepFor(400));
    expect(refused).toContain("re-check the VIN");
    expect(refused).not.toContain("Retry once");
  });

  it("keeps the standard step for every other status, and the catalog step for a vehicle 404", () => {
    for (const status of [0, 401, 402, 403, 409, 429, 500, 502, 503, null, undefined]) {
      expect(vinNextStepFor(status), String(status)).toBe(nextStepFor(status));
    }
    const missing = nextStepFor(404);
    expect(missing).toContain("retry with the id of the one that is plainly the vehicle (vehicle: <id>)");
    expect(missing).toContain("use resolve_vehicle, search_vehicles or decode_vin to find its vehicle id");
    expect(missing).toContain("never substitute another car without saying so");
  });
});

describe("MCP input bounds match the REST API's", () => {
  it("caps max_uses at 1000, the limit POST /api/v1/image-urls enforces", () => {
    const images = [{ make: "Porsche", model: "911", year: 2024 }];
    expect(MCP_TOOL_SCHEMAS.create_car_image_urls.parse({ images, max_uses: 1000 }).max_uses).toBe(1000);
    expect(() => MCP_TOOL_SCHEMAS.create_car_image_urls.parse({ images, max_uses: 1001 })).toThrow();
  });

  it("caps a search at 25 results, the most GET /api/v1/vehicles?q= returns", () => {
    expect(MCP_TOOL_SCHEMAS.search_vehicles.parse({ query: "porsche", limit: 25 }).limit).toBe(25);
    expect(() => MCP_TOOL_SCHEMAS.search_vehicles.parse({ query: "porsche", limit: 26 })).toThrow();
  });
});


describe("make logo input contract", () => {
  it("requires only a make and exposes the image transforms", () => {
    const schema = MCP_TOOLS.get_make_logo.inputSchema;
    expect(schema.parse({ make: " Toyota " })).toEqual({ make: "Toyota", format: "png" });
    expect(schema.parse({ make: "toyota", width: 256, height: 128, fit: "inside", trim: true, padding: 0, format: "auto" })).toMatchObject({ padding: 0, format: "auto" });
    // A width above 1024 is the server's to clamp; a width that is no size is refused here.
    expect(schema.parse({ make: "toyota", width: 1025 })).toMatchObject({ width: 1025 });
    for (const input of [{}, { make: " " }, { make: "toyota", width: 0 }, { make: "toyota", padding: 1 }]) {
      expect(() => schema.parse(input)).toThrow();
    }
    for (const key of ["vehicle", "model", "year", "view", "color", "prompt", "url"]) {
      expect(() => schema.parse({ make: "toyota", [key]: "unsupported" })).toThrow();
    }
    expect(MCP_TOOLS.get_make_logo.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
  });
});


it("rejects ambiguous vehicle selectors consistently before hosted or stdio billing", () => {
  for (const schema of [MCP_TOOLS.get_car_image.inputSchema, MCP_TOOLS.create_3d_model.inputSchema]) {
    expect(() => schema.parse({ vehicle: "veh_395yw8tn73ff8", make: "Toyota", model: "Camry", year: 2025 })).toThrow();
  }
});


describe("chat image presentation", () => {
  const vehicle = { make: "mazda", model: "mx-5", year: 2024, view: "front-3-4", color: "red" };

  it("adds a displayable image for each URL without changing order, billing, expiry or replay metadata", () => {
    const result = {
      data: [
        { url: "https://example.com/delivery/one", vehicle, expires_at: "2026-10-07T00:00:00Z" },
        { url: "https://example.com/delivery/two", vehicle: { ...vehicle, color: "blue" }, expires_at: "2026-10-07T00:00:00Z" },
      ],
      billing: { credits_charged: 2, credits_remaining: 87 },
      idempotent_replayed: true,
    };
    const displayed = withImageMarkdown(result);
    expect(displayed).toMatchObject(result);
    expect(displayed.data.map((item) => item.markdown)).toEqual([
      "![2024 mazda mx-5, front-3-4 view, red](<https://example.com/delivery/one>)",
      "![2024 mazda mx-5, front-3-4 view, blue](<https://example.com/delivery/two>)",
    ]);
    expect(result.data[0]).not.toHaveProperty("markdown");
  });

  it("escapes catalog text and URL delimiters so one result stays one image", () => {
    const result = withImageMarkdown({ data: [{
      url: "https://example.com/car(a)> b",
      vehicle: { ...vehicle, model: "test]\n![other" },
    }] });
    expect(result.data[0]?.markdown).toBe(String.raw`![2024 mazda test\] !\[other, front-3-4 view, red](<https://example.com/car(a)%3E%20b>)`);
  });
});

describe("membersSummary", () => {
  it("counts members and teams and says changes stay on the dashboard", async () => {
    const { membersSummary } = await import("./mcp/index");
    expect(membersSummary({ organization: { name: "Acme" }, members: [{}, {}], teams: [{}] })).toBe(
      "Acme: 2 members, 1 team. Invites, removals and role changes are made on the dashboard by a person."
    );
    expect(MCP_TOOLS.list_members.annotations?.readOnlyHint).toBe(true);
  });
});


it("advertises free availability with a required vehicle selector and optional view", () => {
  const schema = MCP_TOOLS.get_image_availability.inputSchema;
  expect(schema.parse({ vehicle: "veh_78qtwrgh37bkr" }).view).toBeUndefined();
  expect(schema.safeParse({}).success).toBe(false);
  expect(schema.safeParse({ vehicle: "veh_78qtwrgh37bkr", make: "porsche", model: "911", year: 2024 }).success).toBe(false);
  expect(schema.safeParse({ vehicle: "veh_78qtwrgh37bkr", view: "unknown" }).success).toBe(false);
  expect(MCP_TOOLS.get_image_availability.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
});

it("marks editing a public review as replacing previous content", () => {
  expect(MCP_TOOLS.submit_review.annotations.destructiveHint).toBe(true);
});

it("a failed 3D model's summary states the refund and how to order again through MCP", () => {
  const failed = {
    id: "22222222-2222-4222-8222-222222222222",
    status: "failed" as const,
    progress: 0,
    stage: null,
    vehicle: { make: "toyota", model: "camry", year: 2025 },
    color: "#1a2b3c",
    files: null,
    estimated_seconds_remaining: null,
  };
  // The server's retry sentence is written for REST; the summary speaks MCP.
  const restRetry = "The 100 credits charged for this order were refunded; to try again, send POST /api/v1/3d with a new Idempotency-Key (or none).";
  const refunded = model3dSummary({ ...failed, error: { message: "boom", refunded: true, credits_refunded: 100, refunded_at: "2026-11-15T22:21:44.612Z", retry: restRetry } });
  expect(refunded).toContain("failed: boom. Its 100 credits were refunded. To try again, confirm with the human, then call create_3d_model again with a new idempotency_key (or none)");
  expect(refunded).toContain("this order's idempotency_key only replays it.");
  expect(refunded).not.toContain("POST /api/v1/3d");

  const pending = model3dSummary({ ...failed, error: { message: "boom", refunded: false, credits_refunded: 0, refunded_at: null } });
  expect(pending).toContain("failed: boom. Its refund is pending and has not been posted yet. To try again");
  expect(pending).not.toContain("were refunded");

  const free = model3dSummary({ ...failed, error: { message: "boom", refunded: true, credits_refunded: 0, refunded_at: null } });
  expect(free).toContain("failed: boom. Nothing was charged for it, so there is nothing to refund. To try again");

  // A server without the refund fields (before OpenAPI 2.40.0) keeps the old refund statement.
  expect(model3dSummary({ ...failed, error: { message: "boom" } })).toContain("failed: boom. The credits were refunded. To try again");
});
