import type { OpenApiDocument } from "@meterapp/car-image-sdk";
import { describe, expect, it } from "vitest";
import { findEndpoints, formatAll, formatEndpoint, formatEndpointList, listEndpoints, resolveRef, schemaSummary } from "./describe.js";

const doc: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "Car Image API", version: "1.1.0" },
  servers: [{ url: "https://carimage.dev" }],
  security: [{ ApiKey: [] }],
  paths: {
    "/api/v1/images/car": {
      get: {
        operationId: "getCarImage",
        summary: "Get billed vehicle image bytes",
        description: "Every successful call costs exactly 1 credit.",
        parameters: [{ $ref: "#/components/parameters/Make" }, { $ref: "#/components/parameters/View" }, { name: "w", in: "query", schema: { type: "integer", minimum: 1, maximum: 1024 }, description: "Width in pixels" }],
        responses: {
          "200": {
            description: "Image bytes.",
            headers: { "X-Credits-Charged": { schema: { type: "integer", const: 1 } }, "X-Image-Source": { schema: { enum: ["cache", "generated"] } } },
            content: { "image/png": { schema: { type: "string" } }, "image/webp": { schema: { type: "string" } } },
          },
          "402": { $ref: "#/components/responses/Problem" },
        },
        "x-agent-notes": "Do not automatically purchase credits on 402.",
      },
    },
    "/api/v1/image-urls": {
      post: {
        operationId: "createCarImageUrls",
        summary: "Create delivery URLs",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ImageRequest" } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/images/options": {
      get: { operationId: "listImageOptions", summary: "Options", security: [], responses: { "200": { description: "ok" } } },
    },
  },
  components: {
    parameters: {
      Make: { name: "make", in: "query", required: true, schema: { type: "string" }, description: "Vehicle manufacturer" },
      View: { name: "view", in: "query", schema: { $ref: "#/components/schemas/View" }, description: "Camera angle" },
    },
    schemas: {
      View: { type: "string", enum: ["front", "front-3-4", "side"], default: "front-3-4" },
      ImageRequest: {
        type: "object",
        required: ["make", "model", "year"],
        properties: { make: { type: "string", description: "Manufacturer" }, model: { type: "string" }, year: { type: "integer", minimum: 1990 }, view: { $ref: "#/components/schemas/View" } },
      },
    },
    responses: { Problem: { description: "RFC 9457 problem", content: { "application/problem+json": { schema: { type: "object" } } } } },
  },
};

describe("describe formatting", () => {
  it("lists endpoints with method, path and summary", () => {
    const endpoints = listEndpoints(doc);
    expect(endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual(["GET /api/v1/images/car", "POST /api/v1/image-urls", "GET /api/v1/images/options"]);
    const list = formatEndpointList(doc);
    expect(list).toContain("Car Image API 1.1.0");
    expect(list).toContain("Base URL: https://carimage.dev");
    expect(list).toContain("GET   /api/v1/images/car      Get billed vehicle image bytes");
  });

  it("finds endpoints by operation id, path, method+path and keyword", () => {
    expect(findEndpoints(doc, "getCarImage")).toHaveLength(1);
    expect(findEndpoints(doc, "GET /api/v1/images/car")).toHaveLength(1);
    expect(findEndpoints(doc, "/api/v1/image-urls")[0]?.operationId).toBe("createCarImageUrls");
    expect(findEndpoints(doc, "image").length).toBe(3);
    expect(findEndpoints(doc, "nothing")).toHaveLength(0);
    expect(findEndpoints(doc, "all")).toHaveLength(3);
  });

  it("resolves references and summarizes schemas", () => {
    expect(resolveRef(doc, { $ref: "#/components/parameters/Make" }).name).toBe("make");
    expect(schemaSummary(doc, { $ref: "#/components/schemas/View" })).toBe('enum: front|front-3-4|side default "front-3-4"');
    expect(schemaSummary(doc, { type: "integer", minimum: 1, maximum: 1024 })).toBe("integer (1–1024)");
    expect(schemaSummary(doc, { $ref: "#/components/schemas/ImageRequest" })).toBe("object {make*, model*, year*, view}");
    expect(schemaSummary(doc, { type: "array", items: { type: "string" } })).toBe("array<string>");
  });

  it("formats parameters, headers, error codes and agent notes for one endpoint", () => {
    const endpoint = findEndpoints(doc, "getCarImage")[0];
    expect(endpoint).toBeDefined();
    const text = formatEndpoint(doc, endpoint!);
    expect(text).toContain("GET /api/v1/images/car  (getCarImage)");
    expect(text).toContain("Auth: Bearer API key (ApiKey)");
    expect(text).toMatch(/make\s+query\s+required\s+string\s+Vehicle manufacturer/);
    expect(text).toMatch(/view\s+query\s+optional\s+enum: front\|front-3-4\|side default "front-3-4"/);
    expect(text).toContain("headers: X-Credits-Charged (integer const 1), X-Image-Source (enum: cache|generated)");
    expect(text).toContain("content: image/png, image/webp");
    expect(text).toContain("402  RFC 9457 problem");
    expect(text).toContain("agent notes: Do not automatically purchase credits on 402.");
  });

  it("describes request bodies and public endpoints", () => {
    const create = formatEndpoint(doc, findEndpoints(doc, "createCarImageUrls")[0]!);
    expect(create).toContain("Request body (application/json, required): object {make*, model*, year*, view}");
    expect(create).toContain("make*: string  Manufacturer");
    expect(create).toContain("year*: integer (1990–…)");
    const options = formatEndpoint(doc, findEndpoints(doc, "listImageOptions")[0]!);
    expect(options).toContain("Auth: public");
    expect(formatAll(doc).split("\n\n").length).toBeGreaterThanOrEqual(3);
  });
});
