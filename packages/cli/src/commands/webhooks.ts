import { WEBHOOK_EVENT_TYPES, type WebhookEndpoint, type WebhookEventType } from "@meterapp/car-image-sdk";
import { flagInteger, flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { printJson } from "../output.js";

const SIGN_IN_HINT = "Run `car-image login` or set CAR_IMAGE_API_KEY.";
const SUBCOMMANDS = ["list", "add", "show", "test", "enable", "disable", "remove", "deliveries", "events"] as const;

/**
 * `car-image webhooks`: the account's webhook endpoints (https://carimage.dev/docs/webhooks?ref=cli).
 * Free. Changing an endpoint needs an API key (not a connected app); `add`
 * prints the `whsec_…` signing secret once.
 */
export const webhooksCommand: CommandDefinition = {
  name: "webhooks",
  aliases: ["webhook"],
  summary: "Account webhook endpoints: add, test, turn off and on, remove; deliveries and the last 30 days of events",
  usage: [
    "car-image webhooks [list] [--json]",
    "car-image webhooks add <https-url> [--events image.ready,3d_model.ready] [--description <text>] [--json]   prints the signing secret once",
    "car-image webhooks show|test|enable|disable|remove <whe_…> [--json]",
    "car-image webhooks deliveries <whe_…> [--limit 1-100] [--json]",
    "car-image webhooks events [--type <event type>] [--since <ISO time>] [--limit 1-100] [--json]",
  ].join("\n"),
  async run(ctx: CommandContext): Promise<number> {
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
    const sub = ctx.args.positionals[0] ?? "list";
    if (!(SUBCOMMANDS as readonly string[]).includes(sub)) throw new CliError(`Unknown webhooks command "${sub}". Use ${SUBCOMMANDS.join(", ")}.`, 2);
    const client = ctx.clientContext.client;
    const { io } = ctx;
    const asJson = (value: unknown): number => {
      printJson(io, value);
      return 0;
    };
    switch (sub) {
      case "list": {
        const result = await client.listWebhooks();
        if (io.json) return asJson(result);
        if (result.data.length === 0) io.stdout("No webhook endpoints. Add one with `car-image webhooks add <https-url>`.\n");
        for (const endpoint of result.data) io.stdout(describe(endpoint));
        if (result.entitlement.receives !== "all") io.stdout("This plan receives webhook.test only; image, 3D model and upgrade events need a paid plan (`car-image upgrade`).\n");
        return 0;
      }
      case "add": {
        const url = ctx.args.positionals[1];
        if (!url) throw new CliError("Missing endpoint URL", 2, "Example: car-image webhooks add https://example.com/hooks/carimage");
        const result = await client.createWebhook({ url, events: parseEvents(flagString(ctx.args.flags, "events")), description: flagString(ctx.args.flags, "description") });
        if (io.json) return asJson(result);
        io.stdout(describe(result.data));
        io.stdout(`Signing secret (shown once; store it on your server):\n  ${result.data.secret}\n`);
        io.stdout(`Send a test: car-image webhooks test ${result.data.id}\n`);
        return 0;
      }
      case "show": {
        const result = await client.getWebhook(requireId(ctx));
        if (io.json) return asJson(result);
        io.stdout(describe(result.data));
        return 0;
      }
      case "test": {
        const result = await client.testWebhook(requireId(ctx));
        if (io.json) return asJson(result);
        io.stdout(`Queued ${result.data.type} event ${result.data.event_id}; it arrives within a minute. See it with \`car-image webhooks deliveries ${result.data.endpoint_id}\`.\n`);
        return 0;
      }
      case "enable":
      case "disable": {
        const result = await client.updateWebhook(requireId(ctx), { status: sub === "enable" ? "active" : "disabled" });
        if (io.json) return asJson(result);
        io.stdout(describe(result.data));
        return 0;
      }
      case "remove": {
        const result = await client.deleteWebhook(requireId(ctx));
        if (io.json) return asJson(result);
        io.stdout(`Deleted ${result.data.id}.\n`);
        return 0;
      }
      case "deliveries": {
        const result = await client.listWebhookDeliveries(requireId(ctx), { limit: flagInteger(ctx.args.flags, "limit", { min: 1, max: 100 }) });
        if (io.json) return asJson(result);
        if (result.data.length === 0) io.stdout("No deliveries yet.\n");
        for (const delivery of result.data) {
          const answer = delivery.last_status ? `HTTP ${delivery.last_status}` : (delivery.last_error ?? "not tried yet");
          io.stdout(`${delivery.event.created_at}  ${delivery.event.type.padEnd(24)} ${delivery.status.padEnd(9)} ${delivery.attempts} attempt(s), ${answer}\n`);
        }
        return 0;
      }
      case "events": {
        const type = flagString(ctx.args.flags, "type");
        if (type !== undefined && !isEventType(type)) throw new CliError(`Unknown event type "${type}". Known: ${WEBHOOK_EVENT_TYPES.join(", ")}.`, 2);
        const result = await client.listEvents({ type, since: flagString(ctx.args.flags, "since"), limit: flagInteger(ctx.args.flags, "limit", { min: 1, max: 100 }) });
        if (io.json) return asJson(result);
        if (result.data.length === 0) io.stdout("No events in the last 30 days.\n");
        for (const event of result.data) io.stdout(`${event.created_at}  ${event.id}  ${event.type}\n`);
        if (result.has_more) io.stdout("More events: run again with --json and page with the last id (GET /api/v1/events?starting_after=…).\n");
        return 0;
      }
    }
    return 0;
  },
};

function isEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function parseEvents(raw: string | undefined): Array<WebhookEventType | "*"> | undefined {
  if (raw === undefined) return undefined;
  const events = raw.split(",").map((event) => event.trim()).filter(Boolean);
  for (const event of events) {
    if (event !== "*" && !isEventType(event)) throw new CliError(`Unknown event type "${event}". Known: *, ${WEBHOOK_EVENT_TYPES.join(", ")}.`, 2);
  }
  return events as Array<WebhookEventType | "*">;
}

function requireId(ctx: CommandContext): string {
  const id = ctx.args.positionals[1]?.trim();
  if (!id) throw new CliError("Missing endpoint id", 2, "Ids (whe_…) come from `car-image webhooks list`.");
  return id;
}

function describe(endpoint: WebhookEndpoint): string {
  const state = endpoint.status === "active" ? "active" : endpoint.disabled_reason === "failing" ? "off (3 days of failures)" : "off";
  const events = endpoint.events.includes("*") ? "every event" : endpoint.events.join(", ");
  const failing = endpoint.consecutive_failures > 0 ? `, ${endpoint.consecutive_failures} failed attempt(s) in a row` : "";
  return `${endpoint.id}  ${state}  ${endpoint.url}\n  events: ${events}; secret ${endpoint.secret_prefix}…${failing}${endpoint.description ? `\n  ${endpoint.description}` : ""}\n`;
}
