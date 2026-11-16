import { formatApiReference } from "@meterapp/car-image-sdk/mcp";
import type { CommandContext, CommandDefinition } from "../context.js";
import { findEndpoints, formatAll, formatEndpoint, formatEndpointList } from "../describe.js";
import { printJson, warn } from "../output.js";

export const describeCommand: CommandDefinition = {
  name: "describe",
  summary: "Explain the REST API from /openapi.json (endpoints, params, headers, errors, agent notes)",
  usage: "car-image describe [<operationId>|<path>|all] [--json]\n  e.g. car-image describe getCarImage · car-image describe /api/v1/image-urls · car-image describe all",
  async run(ctx: CommandContext): Promise<number> {
    const { io, clientContext } = ctx;
    const target = ctx.args.positionals.join(" ").trim();
    let doc;
    try {
      doc = await clientContext.client.openapi();
    } catch (error) {
      if (io.json) throw error;
      io.stderr(`${warn(io, `Could not fetch ${clientContext.baseUrl}/openapi.json (${error instanceof Error ? error.message : String(error)}); showing the built-in reference.`)}\n\n`);
      io.stdout(`${formatApiReference(target && target !== "all" ? target : undefined)}\n`);
      return 0;
    }

    if (!target) {
      if (io.json) {
        printJson(io, findEndpoints(doc, "all").map(({ method, path, operationId, summary }) => ({ method, path, operationId, summary })));
      } else {
        io.stdout(`${formatEndpointList(doc)}\n`);
      }
      return 0;
    }
    if (target === "all") {
      if (io.json) printJson(io, doc);
      else io.stdout(`${formatAll(doc)}\n`);
      return 0;
    }
    const matches = findEndpoints(doc, target);
    if (matches.length === 0) {
      io.stderr(`No endpoint matches "${target}".\n\n`);
      io.stdout(`${formatEndpointList(doc)}\n`);
      return 1;
    }
    if (io.json) {
      printJson(io, matches.map(({ method, path, operationId, operation }) => ({ method, path, operationId, operation })));
      return 0;
    }
    io.stdout(`${matches.map((endpoint) => formatEndpoint(doc, endpoint)).join("\n\n")}\n`);
    return 0;
  },
};
