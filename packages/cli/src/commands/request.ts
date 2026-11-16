import { REQUEST_KINDS, REQUEST_SORTS, REQUEST_STATUSES, type RequestRecord } from "@meterapp/car-image-sdk";
import { flagChoice, flagInteger, flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { keyValues, paint, printJson, table } from "../output.js";

const SUBCOMMANDS = ["list", "vehicle", "feature", "show", "upvote", "comment"] as const;
const USAGE = [
  "car-image request list [--kind vehicle|feature] [--status open|planned|in_progress|done|declined] [--sort top|new] [--limit 20] [--json]",
  'car-image request vehicle <make> <model> [--year 2024] [--note "why you need it"]',
  'car-image request feature "<title>" [--details "..."]',
  "car-image request show <id>",
  "car-image request upvote <id>",
  'car-image request comment <id> "<text>"',
].join("\n");

export const SIGN_IN_HINT = "Run `car-image login` or set CAR_IMAGE_API_KEY.";

/** "Toyota Sienna (2024)" for a vehicle request, the title otherwise. */
export function requestLabel(request: Pick<RequestRecord, "kind" | "title" | "vehicle">): string {
  if (request.kind === "vehicle" && request.vehicle) {
    const { make, model, year } = request.vehicle;
    return `${make} ${model}${year ? ` (${year})` : ""}`;
  }
  return request.title;
}

/**
 * A request's public page with `?ref=cli`. The API returns it untagged -- it
 * is data there, not a link we publish -- and this is where it becomes one:
 * printed in a terminal, where no click carries a referrer. Pages on any
 * other host (a local or preview server) are left alone.
 */
export function requestPageLink(url: string): string {
  try {
    const page = new URL(url);
    if (page.hostname !== "carimage.dev") return url;
    page.searchParams.set("ref", "cli");
    return page.toString();
  } catch {
    return url;
  }
}

export function votesLabel(votes: number): string {
  return `${votes.toLocaleString("en-US")} vote${votes === 1 ? "" : "s"}`;
}

function requireSignIn(ctx: CommandContext): void {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
}

function requireId(ctx: CommandContext, action: string): string {
  const id = ctx.args.positionals[1]?.trim();
  if (!id) throw new CliError(`Missing request id`, 2, `Example: car-image request ${action} <id> — ids come from \`car-image request list\`.`);
  return id;
}

async function list(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const result = await ctx.clientContext.client.listRequests({
    kind: flagChoice(flags, "kind", REQUEST_KINDS),
    status: flagChoice(flags, "status", REQUEST_STATUSES),
    sort: flagChoice(flags, "sort", REQUEST_SORTS),
    limit: flagInteger(flags, "limit", { min: 1, max: 100 }),
    cursor: flagString(flags, "cursor"),
  });
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  if (result.data.length === 0) {
    ctx.io.stdout('No requests yet. File one: car-image request vehicle <make> <model>, or car-image request feature "<title>".\n');
    return 0;
  }
  const rows = result.data.map((request) => [String(request.votes), request.kind, requestLabel(request), request.id, request.status]);
  ctx.io.stdout(`${table(rows, ["votes", "kind", "title", "id", "status"])}\n`);
  if (result.next_cursor) ctx.io.stdout(`\n${paint(ctx.io, "dim", `More: car-image request list --cursor ${result.next_cursor}`)}\n`);
  ctx.io.stdout(`\n${paint(ctx.io, "dim", "Upvote with: car-image request upvote <id>")}\n`);
  return 0;
}

function printCreated(ctx: CommandContext, request: RequestRecord, deduplicated: boolean): void {
  const label = requestLabel(request);
  const track = request.url ? ` Track it at ${paint(ctx.io, "underline", requestPageLink(request.url))}` : "";
  if (deduplicated) {
    ctx.io.stdout(`Already requested — added your upvote (${votesLabel(request.votes)}).${track}\n`);
  } else {
    ctx.io.stdout(`Requested ${label} — ${votesLabel(request.votes)}.${track}\n`);
  }
}

async function vehicle(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const [, make, ...rest] = ctx.args.positionals;
  const model = rest.join(" ").trim();
  if (!make || !model) throw new CliError("Provide the make and the model", 2, 'Example: car-image request vehicle Toyota Sienna --year 2024 --note "hybrid trim"');
  const year = flagInteger(ctx.args.flags, "year", { min: 1900, max: 2100 });
  const body = flagString(ctx.args.flags, "note");
  const result = await ctx.clientContext.client.createRequest({ kind: "vehicle", make, model, year, body });
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  printCreated(ctx, result.data, result.deduplicated);
  if (!result.deduplicated) ctx.io.stdout(`${paint(ctx.io, "dim", "We email you when it is live.")}\n`);
  return 0;
}

async function feature(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const title = ctx.args.positionals.slice(1).join(" ").trim();
  if (!title) throw new CliError("Provide a title for the feature", 2, 'Example: car-image request feature "Interior views" --details "dashboard and seats"');
  const body = flagString(ctx.args.flags, "details");
  const result = await ctx.clientContext.client.createRequest({ kind: "feature", title, body });
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  printCreated(ctx, result.data, result.deduplicated);
  return 0;
}

async function show(ctx: CommandContext): Promise<number> {
  const id = requireId(ctx, "show");
  const result = await ctx.clientContext.client.getRequest(id);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  const request = result.data;
  const rows: Array<[string, string]> = [
    ["title", requestLabel(request)],
    ["kind", request.kind],
    ["status", request.status],
    ["votes", `${request.votes}${request.viewer?.voted ? " (including yours)" : ""}`],
    ["comments", String(request.comment_count)],
    ["by", request.author],
    ["created", request.created_at],
    ["id", request.id],
  ];
  if (request.url) rows.push(["url", requestPageLink(request.url)]);
  ctx.io.stdout(`${keyValues(ctx.io, rows)}\n`);
  if (request.body) ctx.io.stdout(`\n${request.body}\n`);
  if (request.comments.length) {
    ctx.io.stdout(`\n${paint(ctx.io, "bold", `Comments (${request.comments.length})`)}\n`);
    for (const comment of request.comments) ctx.io.stdout(`${paint(ctx.io, "dim", `${comment.author} · ${comment.created_at}`)}\n  ${comment.body}\n`);
  }
  return 0;
}

async function upvote(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const id = requireId(ctx, "upvote");
  const result = await ctx.clientContext.client.voteRequest(id);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  ctx.io.stdout(`Upvoted ${requestLabel(result.data)} — ${votesLabel(result.data.votes)}.\n`);
  return 0;
}

async function comment(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const id = requireId(ctx, "comment");
  const text = ctx.args.positionals.slice(2).join(" ").trim();
  if (!text) throw new CliError("Provide the comment text", 2, 'Example: car-image request comment <id> "Also the hybrid trim, please"');
  const result = await ctx.clientContext.client.commentOnRequest(id, text);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  ctx.io.stdout(`Comment added to ${result.data.request_id}.\n`);
  return 0;
}

export const requestCommand: CommandDefinition = {
  name: "request",
  aliases: ["requests"],
  summary: "Ask for a missing vehicle or a feature, browse and upvote what others asked for (free)",
  usage: USAGE,
  async run(ctx: CommandContext): Promise<number> {
    const action = (ctx.args.positionals[0] ?? "list").toLowerCase();
    switch (action) {
      case "list":
        return list(ctx);
      case "vehicle":
        return vehicle(ctx);
      case "feature":
        return feature(ctx);
      case "show":
        return show(ctx);
      case "upvote":
        return upvote(ctx);
      case "comment":
        return comment(ctx);
      default:
        throw new CliError(`Unknown request action "${action}"`, 2, `Use one of: ${SUBCOMMANDS.join(", ")}. Run \`car-image request --help\` for usage.`);
    }
  },
};
