import { CarImageClient, DEFAULT_BASE_URL, type FetchLike } from "@meterapp/car-image-sdk";
import { flagString, type FlagValue } from "./args.js";
import { isLegacyBaseUrl, type CliConfig, type Env } from "./config.js";
import { CLI_VERSION } from "./version.js";

export type KeySource = "flag" | "env" | "config" | null;

export interface ClientContext {
  baseUrl: string;
  apiKey: string | undefined;
  keySource: KeySource;
  client: CarImageClient;
  userAgent: string;
}

/** `car-image-cli/1.0.0 (darwin; node/v22.1.0)`; the MCP server identifies as `car-image-mcp`. */
export function userAgent(kind: "cli" | "mcp" = "cli"): string {
  return `car-image-${kind}/${CLI_VERSION} (${process.platform}; node/${process.version})`;
}

/** `--base-url` > `CAR_IMAGE_API_URL` > config > default; a legacy alias host is read as the default. */
export function resolveBaseUrl(flags: Record<string, FlagValue>, env: Env, config: CliConfig): string {
  const raw = (flagString(flags, "base-url") ?? env.CAR_IMAGE_API_URL?.trim() ?? config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return isLegacyBaseUrl(raw) ? DEFAULT_BASE_URL : raw;
}

/** `--api-key` > `CAR_IMAGE_API_KEY` > config file. */
export function resolveApiKey(flags: Record<string, FlagValue>, env: Env, config: CliConfig): { apiKey: string | undefined; source: KeySource } {
  const fromFlag = flagString(flags, "api-key")?.trim();
  if (fromFlag) return { apiKey: fromFlag, source: "flag" };
  const fromEnv = env.CAR_IMAGE_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };
  if (config.apiKey) return { apiKey: config.apiKey, source: "config" };
  return { apiKey: undefined, source: null };
}

export function createClientContext(
  flags: Record<string, FlagValue>,
  env: Env,
  config: CliConfig,
  options: { kind?: "cli" | "mcp"; fetch?: FetchLike; maxRetries?: number } = {}
): ClientContext {
  const baseUrl = resolveBaseUrl(flags, env, config);
  const { apiKey, source } = resolveApiKey(flags, env, config);
  const agent = userAgent(options.kind ?? "cli");
  const client = new CarImageClient({
    apiKey: apiKey ?? "",
    baseUrl,
    userAgent: agent,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("X-CarImage-Integration", options.kind === "mcp" ? "mcp-stdio" : "cli");
      const host = env.CAR_IMAGE_HOST;
      if (host && ["claude", "claude-code", "chatgpt", "codex", "cursor"].includes(host)) {
        headers.set("X-CarImage-Host", host);
      }
      return (options.fetch ?? globalThis.fetch)(input, { ...init, headers });
    },
    maxRetries: options.maxRetries,
  });
  return { baseUrl, apiKey, keySource: source, client, userAgent: agent };
}
