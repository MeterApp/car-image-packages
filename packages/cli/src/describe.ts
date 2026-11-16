import type { OpenApiDocument } from "@meterapp/car-image-sdk";

type JsonObject = Record<string, unknown>;

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export interface EndpointSummary {
  method: string;
  path: string;
  operationId: string | null;
  summary: string;
  operation: JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Follows `#/components/...` references (repeatedly) inside the same document. */
export function resolveRef(doc: OpenApiDocument, node: unknown, depth = 0): JsonObject {
  if (!isObject(node)) return {};
  const ref = node.$ref;
  if (typeof ref !== "string" || depth > 8) return node;
  if (!ref.startsWith("#/")) return node;
  let current: unknown = doc;
  for (const segment of ref.slice(2).split("/")) {
    if (!isObject(current)) return node;
    current = current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isObject(current) ? resolveRef(doc, current, depth + 1) : node;
}

export function listEndpoints(doc: OpenApiDocument): EndpointSummary[] {
  const endpoints: EndpointSummary[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!isObject(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof operation.operationId === "string" ? operation.operationId : null,
        summary: typeof operation.summary === "string" ? operation.summary : "",
        operation,
      });
    }
  }
  return endpoints;
}

/** Matches by operationId, `METHOD /path`, path fragment or summary words (case-insensitive). */
export function findEndpoints(doc: OpenApiDocument, query: string): EndpointSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle || needle === "all") return listEndpoints(doc);
  const endpoints = listEndpoints(doc);
  const exact = endpoints.filter(
    (endpoint) => endpoint.operationId?.toLowerCase() === needle || `${endpoint.method} ${endpoint.path}`.toLowerCase() === needle || endpoint.path.toLowerCase() === needle
  );
  if (exact.length) return exact;
  return endpoints.filter(
    (endpoint) =>
      endpoint.path.toLowerCase().includes(needle) ||
      (endpoint.operationId ?? "").toLowerCase().includes(needle) ||
      endpoint.summary.toLowerCase().includes(needle)
  );
}

export function wrap(text: string, width = 88, indent = ""): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line.length + 1 + word.length) > width - indent.length) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

/** One-line human summary of a JSON Schema fragment. */
export function schemaSummary(doc: OpenApiDocument, raw: unknown, depth = 0): string {
  const schema = resolveRef(doc, raw);
  if (Object.keys(schema).length === 0) return "any";
  const parts: string[] = [];
  if (Array.isArray(schema.enum)) {
    parts.push(`enum: ${schema.enum.map(String).join("|")}`);
  } else if (schema.const !== undefined) {
    parts.push(typeof schema.type === "string" ? `${schema.type} const ${JSON.stringify(schema.const)}` : `const ${JSON.stringify(schema.const)}`);
  } else if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const options = (schema.oneOf ?? schema.anyOf) as unknown[];
    parts.push(options.map((option) => schemaSummary(doc, option, depth + 1)).join(" | "));
  } else {
    const type = Array.isArray(schema.type) ? schema.type.join("|") : typeof schema.type === "string" ? schema.type : schema.properties ? "object" : schema.items ? "array" : "any";
    if (type === "array") {
      parts.push(`array<${depth > 2 ? "…" : schemaSummary(doc, schema.items, depth + 1)}>`);
    } else if (type === "object" && isObject(schema.properties)) {
      const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
      const fields = Object.keys(schema.properties).map((key) => (required.has(key) ? `${key}*` : key));
      parts.push(depth > 2 ? "object" : `object {${fields.join(", ")}}`);
    } else {
      parts.push(type);
    }
  }
  const bounds: string[] = [];
  if (typeof schema.minimum === "number" || typeof schema.maximum === "number") {
    bounds.push(`${schema.minimum ?? "…"}–${schema.maximum ?? "…"}`);
  }
  if (typeof schema.minLength === "number" || typeof schema.maxLength === "number") {
    bounds.push(`len ${schema.minLength ?? 0}–${schema.maxLength ?? "…"}`);
  }
  if (typeof schema.minItems === "number" || typeof schema.maxItems === "number") {
    bounds.push(`items ${schema.minItems ?? 0}–${schema.maxItems ?? "…"}`);
  }
  if (typeof schema.format === "string") bounds.push(schema.format);
  if (bounds.length) parts.push(`(${bounds.join(", ")})`);
  if (schema.default !== undefined) parts.push(`default ${JSON.stringify(schema.default)}`);
  return parts.join(" ");
}

interface ParameterRow {
  name: string;
  location: string;
  required: boolean;
  schema: string;
  description: string;
}

function parameterRows(doc: OpenApiDocument, operation: JsonObject): ParameterRow[] {
  const raw = Array.isArray(operation.parameters) ? operation.parameters : [];
  return raw.map((entry) => {
    const parameter = resolveRef(doc, entry);
    return {
      name: String(parameter.name ?? "?"),
      location: String(parameter.in ?? "query"),
      required: parameter.required === true,
      schema: schemaSummary(doc, parameter.schema),
      description: typeof parameter.description === "string" ? parameter.description : "",
    };
  });
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function securityLabel(doc: OpenApiDocument, operation: JsonObject): string {
  const security = Array.isArray(operation.security) ? operation.security : Array.isArray(doc.security) ? doc.security : [];
  if (security.length === 0) return "public";
  const schemes = security.flatMap((entry) => (isObject(entry) ? Object.keys(entry) : []));
  if (schemes.length === 0 || security.some((entry) => isObject(entry) && Object.keys(entry).length === 0)) return "public";
  return `Bearer API key (${schemes.join(", ")})`;
}

/** Full human description of one operation. */
export function formatEndpoint(doc: OpenApiDocument, endpoint: EndpointSummary): string {
  const { operation } = endpoint;
  const lines: string[] = [];
  lines.push(`${endpoint.method} ${endpoint.path}${endpoint.operationId ? `  (${endpoint.operationId})` : ""}`);
  if (endpoint.summary) lines.push(`  ${endpoint.summary}`);
  if (typeof operation.description === "string" && operation.description.trim()) {
    lines.push(wrap(operation.description, 88, "  "));
  }
  lines.push(`  Auth: ${securityLabel(doc, operation)}`);

  const parameters = parameterRows(doc, operation);
  if (parameters.length) {
    lines.push("  Parameters:");
    const nameWidth = Math.max(...parameters.map((row) => row.name.length));
    const schemaWidth = Math.min(48, Math.max(...parameters.map((row) => row.schema.length)));
    for (const row of parameters) {
      const head = `    ${pad(row.name, nameWidth)}  ${pad(row.location, 6)}  ${row.required ? "required" : "optional"}  ${pad(row.schema, schemaWidth)}`;
      lines.push(row.description ? `${head}  ${row.description}` : head.trimEnd());
    }
  }

  const requestBody = resolveRef(doc, operation.requestBody);
  if (isObject(requestBody.content)) {
    for (const [mediaType, media] of Object.entries(requestBody.content)) {
      if (!isObject(media)) continue;
      lines.push(`  Request body (${mediaType}${requestBody.required === true ? ", required" : ""}): ${schemaSummary(doc, media.schema)}`);
      const schema = resolveRef(doc, media.schema);
      if (isObject(schema.properties)) {
        const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
        for (const [key, value] of Object.entries(schema.properties)) {
          const property = resolveRef(doc, value);
          const description = typeof property.description === "string" ? `  ${property.description}` : "";
          lines.push(`    ${key}${required.has(key) ? "*" : ""}: ${schemaSummary(doc, value, 1)}${description}`);
        }
      }
    }
  }

  if (isObject(operation.responses)) {
    lines.push("  Responses:");
    for (const [status, value] of Object.entries(operation.responses)) {
      const response = resolveRef(doc, value);
      const description = typeof response.description === "string" ? response.description : "";
      lines.push(`    ${pad(status, 4)} ${description}`.trimEnd());
      if (isObject(response.headers)) {
        const headers = Object.entries(response.headers).map(([name, header]) => `${name} (${schemaSummary(doc, resolveRef(doc, header).schema)})`);
        if (headers.length) lines.push(`         headers: ${headers.join(", ")}`);
      }
      if (isObject(response.content)) {
        const types = Object.keys(response.content);
        if (types.length) lines.push(`         content: ${types.join(", ")}`);
      }
    }
  }

  for (const [key, value] of Object.entries(operation)) {
    if (key.startsWith("x-") && typeof value === "string") {
      lines.push(wrap(`${key.replace(/^x-/, "").replace(/-/g, " ")}: ${value}`, 88, "  "));
    }
  }
  return lines.join("\n");
}

/** `METHOD path — summary` per line, aligned. */
export function formatEndpointList(doc: OpenApiDocument): string {
  const endpoints = listEndpoints(doc);
  if (endpoints.length === 0) return "No endpoints found in the OpenAPI document.";
  const methodWidth = Math.max(...endpoints.map((endpoint) => endpoint.method.length));
  const pathWidth = Math.max(...endpoints.map((endpoint) => endpoint.path.length));
  const title = `${doc.info?.title ?? "API"} ${doc.info?.version ?? ""}`.trim();
  const server = doc.servers?.[0]?.url;
  const header = [title, server ? `Base URL: ${server}` : null, ""].filter((line): line is string => line !== null);
  const rows = endpoints.map((endpoint) => `${pad(endpoint.method, methodWidth)}  ${pad(endpoint.path, pathWidth)}  ${endpoint.summary}`.trimEnd());
  return [...header, ...rows, "", "Run `car-image describe <operationId|path>` for parameters, headers and error codes, or `car-image describe all`."].join("\n");
}

export function formatAll(doc: OpenApiDocument): string {
  return listEndpoints(doc)
    .map((endpoint) => formatEndpoint(doc, endpoint))
    .join("\n\n");
}
