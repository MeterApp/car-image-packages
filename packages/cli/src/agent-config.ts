import { DEFAULT_BASE_URL } from "@meterapp/car-image-sdk";
import { MCP_DOCUMENTED_EXTRAS, MCP_TOOLSETS } from "@meterapp/car-image-sdk/mcp";
import { PACKAGE_NAME } from "./version.js";

export const AGENT_HOSTS = ["claude-code", "claude-desktop", "cursor", "chatgpt", "generic"] as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];

export const KEY_PLACEHOLDER = "${CAR_IMAGE_API_KEY}";

export interface AgentConfigOptions {
  host: AgentHost;
  /** Only print the remote (HTTP) configuration. */
  remoteOnly: boolean;
  baseUrl: string;
}

export function mcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

/**
 * What a host runs for the stdio server. `@latest`, because a bare name lets
 * npx reuse whatever copy it finds (an old global install included) for as
 * long as the configuration lives.
 */
export const STDIO_PACKAGE_SPEC = `${PACKAGE_NAME}@latest`;

/** Stdio server entry for `mcpServers` maps (Claude Desktop, Cursor, Claude Code). */
export function stdioServerConfig(baseUrl: string, host?: string): Record<string, unknown> {
  const env: Record<string, string> = { CAR_IMAGE_API_KEY: KEY_PLACEHOLDER };
  if (host) env.CAR_IMAGE_HOST = host;
  if (baseUrl.replace(/\/+$/, "") !== DEFAULT_BASE_URL) env.CAR_IMAGE_API_URL = baseUrl;
  return { command: "npx", args: ["-y", STDIO_PACKAGE_SPEC, "mcp"], env };
}

/** Remote Streamable HTTP entry with the key in a header (never in the URL). */
export function remoteServerConfig(baseUrl: string, host?: string): Record<string, unknown> {
  return { type: "http", url: mcpUrl(baseUrl), headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}`, ...(host ? { "X-CarImage-Host": host } : {}) } };
}

/**
 * Remote entry for Claude Code: no key, so it signs in with the browser from
 * /mcp. Claude Code turns that sign-in off whenever an Authorization header is
 * configured, whatever its value, so this entry never carries one.
 */
export function remoteSignInServerConfig(baseUrl: string, host?: string): Record<string, unknown> {
  return { type: "http", url: mcpUrl(baseUrl), ...(host ? { headers: { "X-CarImage-Host": host } } : {}) };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const KEY_NOTE = `Set CAR_IMAGE_API_KEY in the environment that launches the agent (or replace ${KEY_PLACEHOLDER} with the key in a file that is not committed). Never paste a key into a URL, prompt or repository.`;

/** The tools shared by both toolsets, read off the SDK so it cannot drift. */
export const CORE_TOOLS_NOTE = `Tools (core): ${MCP_TOOLSETS.core.join(", ")}`;

/**
 * How to opt into the rest. The configurations printed here stay on the core
 * toolset: fewer, sharper tools cost an agent less context.
 */
export function toolsetNote(baseUrl: string): string {
  return `The full hosted toolset includes ${MCP_DOCUMENTED_EXTRAS.join(", ")}. To select the core tools over HTTP, use ${mcpUrl(baseUrl)}?toolset=core. For all stdio tools, run \`car-image mcp --toolset all\`.`;
}

function servers(baseUrl: string, remoteOnly: boolean, host?: string): Record<string, unknown> {
  return remoteOnly
    ? { "car-image": remoteServerConfig(baseUrl, host) }
    : { "car-image": remoteServerConfig(baseUrl, host), "car-image-local": stdioServerConfig(baseUrl, host) };
}

export function renderAgentConfig(options: AgentConfigOptions): string {
  const { host, remoteOnly, baseUrl } = options;
  const url = mcpUrl(baseUrl);
  const attributionHost = host === "claude-desktop" ? "claude" : host === "generic" ? undefined : host;
  const envArg = baseUrl.replace(/\/+$/, "") === DEFAULT_BASE_URL ? "" : ` --env CAR_IMAGE_API_URL=${baseUrl}`;

  switch (host) {
    case "claude-code": {
      const lines = [
        "# Claude Code",
        "",
        "# Remote MCP server (recommended; nothing to install, no key). Add it, then run /mcp,",
        "# select car-image and sign in with your browser:",
        `claude mcp add --transport http car-image ${url} --header "X-CarImage-Host: claude-code"`,
        "",
        "# With an API key instead (CI, or a machine without a browser). X-Api-Key, not Authorization:",
        "# Claude Code turns browser sign-in off whenever an Authorization header is set, even an empty one.",
        `claude mcp add --transport http car-image ${url} --header "X-Api-Key: ${KEY_PLACEHOLDER}" --header "X-CarImage-Host: claude-code"`,
      ];
      if (!remoteOnly) {
        lines.push(
          "",
          "# Local stdio server (runs `car-image mcp` through npx):",
          `claude mcp add car-image-local --env CAR_IMAGE_API_KEY=${KEY_PLACEHOLDER} --env CAR_IMAGE_HOST=claude-code${envArg} -- npx -y ${STDIO_PACKAGE_SPEC} mcp`
        );
      }
      const remote = remoteSignInServerConfig(baseUrl, attributionHost);
      lines.push(
        "",
        "# Project-scoped alternative: .mcp.json in the repository root (signs in with the browser)",
        json({ mcpServers: remoteOnly ? { "car-image": remote } : { "car-image": remote, "car-image-local": stdioServerConfig(baseUrl, attributionHost) } }),
        "",
        `# ${CORE_TOOLS_NOTE}`,
        `# ${toolsetNote(baseUrl)}`,
        `# ${KEY_NOTE}`
      );
      return lines.join("\n");
    }
    case "claude-desktop": {
      const lines = [
        "# Claude Desktop",
        "",
        "# Remote connector: Settings → Connectors → Add custom connector →",
        `#   URL: ${url}`,
        "#   Claude Desktop's connector dialog cannot send a static API-key header; use the local stdio server",
        "#   below (or Claude Code with --header) for key-based access.",
      ];
      if (!remoteOnly) {
        lines.push(
          "",
          "# Local stdio server: add to claude_desktop_config.json",
          "#   macOS: ~/Library/Application Support/Claude/claude_desktop_config.json",
          "#   Windows: %APPDATA%\\Claude\\claude_desktop_config.json",
          json({ mcpServers: { "car-image": stdioServerConfig(baseUrl, attributionHost) } })
        );
      }
      lines.push("", `# ${CORE_TOOLS_NOTE}`, `# ${toolsetNote(baseUrl)}`, `# ${KEY_NOTE}`);
      return lines.join("\n");
    }
    case "cursor": {
      return [
        "# Cursor — save as .cursor/mcp.json (project) or ~/.cursor/mcp.json (global)",
        json({ mcpServers: servers(baseUrl, remoteOnly, attributionHost) }),
        "",
        `# ${CORE_TOOLS_NOTE}`,
        `# ${toolsetNote(baseUrl)}`,
        `# ${KEY_NOTE}`,
      ].join("\n");
    }
    case "chatgpt": {
      return [
        "# ChatGPT",
        "",
        "# Apps SDK / connector (developer mode): Settings → Connectors → Create →",
        `#   MCP server URL: ${url}`,
        "#   Authentication: OAuth. ChatGPT registers itself and sends you to carimage.dev to sign in and approve.",
        "",
        "# Custom GPT with Actions (works today):",
        "#   1. Create a GPT → Configure → Create new action → Import from URL",
        `#      ${baseUrl}/openapi.json`,
        "#   2. Authentication: API Key → Auth type: Bearer → paste your cimg_… key",
        "#   3. Privacy policy URL: " + `${baseUrl}/privacy?ref=cli`,
        "#   Legacy manifest for reference: " + `${baseUrl}/.well-known/ai-plugin.json`,
        "",
        `# ${CORE_TOOLS_NOTE}`,
        `# ${toolsetNote(baseUrl)}`,
        `# ${KEY_NOTE}`,
      ].join("\n");
    }
    default: {
      return [
        "# Generic MCP client configuration",
        "",
        "# Remote Streamable HTTP (MCP 2025-06-18 and later):",
        json(remoteServerConfig(baseUrl, attributionHost)),
      ]
        .concat(remoteOnly ? [] : ["", "# Local stdio:", json(stdioServerConfig(baseUrl, attributionHost))])
        .concat(["", `# ${CORE_TOOLS_NOTE}`, `# ${toolsetNote(baseUrl)}`, `# ${KEY_NOTE}`])
        .join("\n");
    }
  }
}
