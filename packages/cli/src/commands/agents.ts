import { MCP_TOOLSET_NAMES, type McpToolset } from "@meterapp/car-image-sdk/mcp";
import { AGENT_HOSTS, remoteServerConfig, remoteSignInServerConfig, renderAgentConfig, stdioServerConfig, type AgentHost } from "../agent-config.js";
import { flagChoice } from "../args.js";
import { createClientContext } from "../client.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { serveMcpStdio } from "../mcp/server.js";
import { printJson } from "../output.js";

export const agentConfigCommand: CommandDefinition = {
  name: "agent-config",
  summary: "Print ready-to-paste MCP configuration for Claude Code, Claude Desktop, Cursor, ChatGPT or any client",
  usage: "car-image agent-config [--host claude-code|claude-desktop|cursor|chatgpt|generic] [--remote] [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const host: AgentHost = flagChoice(ctx.args.flags, "host", AGENT_HOSTS) ?? "generic";
    const remoteOnly = ctx.args.flags.remote === true;
    const baseUrl = ctx.clientContext.baseUrl;
    if (ctx.io.json) {
      // Claude Code signs in with the browser, which any Authorization header turns off.
      const remote = host === "claude-code" ? remoteSignInServerConfig(baseUrl) : remoteServerConfig(baseUrl);
      printJson(ctx.io, {
        mcpServers: remoteOnly ? { "car-image": remote } : { "car-image": remote, "car-image-local": stdioServerConfig(baseUrl) },
      });
      return 0;
    }
    ctx.io.stdout(`${renderAgentConfig({ host, remoteOnly, baseUrl })}\n`);
    return 0;
  },
};

export const mcpCommand: CommandDefinition = {
  name: "mcp",
  summary: "Run the stdio MCP server (core tools: resolve_vehicle, search_vehicles, decode_vin, check_vehicles, get_car_image, create_car_image_urls, get_account, request_feature, report_issue, upvote_feedback, submit_review; --toolset all adds the rest)",
  usage: "car-image mcp [--toolset core|all]\n  Reads CAR_IMAGE_API_KEY or the stored key. Configure with `car-image agent-config`.",
  async run(ctx: CommandContext): Promise<number> {
    const toolset: McpToolset = flagChoice(ctx.args.flags, "toolset", MCP_TOOLSET_NAMES) ?? "core";
    // A dedicated client so the REST API can attribute traffic to the MCP server.
    const mcpContext = createClientContext(ctx.args.flags, ctx.env, ctx.config, { kind: "mcp" });
    if (!mcpContext.apiKey) {
      ctx.io.stderr("car-image mcp: no API key configured; tools will return authentication errors until CAR_IMAGE_API_KEY is set or `car-image login` has run.\n");
    }
    await serveMcpStdio(mcpContext.client, (line) => ctx.io.stderr(line), toolset);
    return 0;
  },
};
