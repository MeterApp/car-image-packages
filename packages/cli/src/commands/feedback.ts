import { readFile } from "node:fs/promises";
import {
  IMAGE_REPORT_CATEGORIES,
  IMAGE_REPORT_TYPES,
  REQUEST_KINDS,
  REQUEST_SORTS,
  REQUEST_STATUSES,
  type FiledFeedbackResponse,
  type ImageReportInput,
  type ImageReportResponse,
  type IssueContext,
  type OwnReview,
  type RequestRecord,
} from "@meterapp/car-image-sdk";
import { flagBoolean, flagChoice, flagInteger, flagString } from "../args.js";
import { lastErrorPath } from "../config.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { keyValues, paint, printJson, table } from "../output.js";
import { CLI_VERSION } from "../version.js";
import { flagColor, flagView } from "./images.js";
import { requestLabel, requestPageLink, SIGN_IN_HINT, votesLabel } from "./request.js";

/**
 * The feedback board from a terminal (docs/customer-feedback.md, "Surfaces"):
 * the same actions as the REST API and the MCP tools. `car-image feedback`
 * `report-image` files a tracked image report (POST /api/v1/images/reports).
 */
const SUBCOMMANDS = ["list", "show", "mine", "request", "report", "report-image", "upvote", "comment"] as const;
const USAGE = [
  "car-image feedback list [--kind feature|issue|vehicle] [--status open|planned|in_progress|done|declined|duplicate] [--sort top|new|recent_activity] [--q <text>] [--limit 25] [--json]",
  "car-image feedback show <id>",
  "car-image feedback mine",
  'car-image feedback request "<title>" [--details "..."] [--force]',
  'car-image feedback report "<what went wrong>" [--details "..."] [--request-id <id> | --last] [--force]',
  'car-image feedback report-image (--request-id <id> | --asset-id <id> | --vehicle <veh_…> | --make … --model … --year …) [--view …] [--color …] [--type wrong_image|poor_quality] [--category identity|camera|paint|quality] [--reason "..."] [--ref <your id>]',
  "car-image feedback report-image --type missing_vehicle --make … --model … --year … [--reason \"...\"] [--ref <your id>]",
  "car-image feedback report-image show <report id>",
  "car-image feedback upvote <id> [--remove]",
  'car-image feedback comment <id> "<text>"',
].join("\n");

function requireSignIn(ctx: CommandContext): void {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
}

function requireId(ctx: CommandContext, action: string): string {
  const id = ctx.args.positionals[1]?.trim();
  if (!id) throw new CliError("Missing item id", 2, `Example: car-image feedback ${action} <id> — ids come from \`car-image feedback list\`.`);
  return id;
}

function printList(ctx: CommandContext, data: RequestRecord[], empty: string): void {
  if (data.length === 0) {
    ctx.io.stdout(`${empty}\n`);
    return;
  }
  const rows = data.map((item) => [String(item.votes), item.kind, requestLabel(item), item.id, item.status + (item.visibility === "private" ? " (private)" : "")]);
  ctx.io.stdout(`${table(rows, ["votes", "kind", "title", "id", "status"])}\n`);
}

async function list(ctx: CommandContext, mine: boolean): Promise<number> {
  const { flags } = ctx.args;
  if (mine) requireSignIn(ctx);
  const params = {
    kind: flagChoice(flags, "kind", REQUEST_KINDS),
    status: flagChoice(flags, "status", REQUEST_STATUSES),
    sort: mine ? ("recent_activity" as const) : flagChoice(flags, "sort", REQUEST_SORTS),
    q: flagString(flags, "q"),
    limit: flagInteger(flags, "limit", { min: 1, max: 100 }),
    cursor: flagString(flags, "cursor"),
  };
  const result = mine ? await ctx.clientContext.client.listMyFeedback(params) : await ctx.clientContext.client.listFeedback(params);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  printList(ctx, result.data, mine ? "Nothing yet. car-image feedback request \"<idea>\" or car-image feedback report \"<problem>\"." : "Nothing matches.");
  if (result.next_cursor) ctx.io.stdout(`\n${paint(ctx.io, "dim", `More: car-image feedback ${mine ? "mine" : "list"} --cursor ${result.next_cursor}`)}\n`);
  if (!mine && result.data.length) ctx.io.stdout(`\n${paint(ctx.io, "dim", "Upvote with: car-image feedback upvote <id>")}\n`);
  return 0;
}

async function show(ctx: CommandContext): Promise<number> {
  const id = requireId(ctx, "show");
  const result = await ctx.clientContext.client.getFeedback(id);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  const item = result.data;
  const rows: Array<[string, string]> = [
    ["title", requestLabel(item)],
    ["kind", item.kind + (item.visibility === "private" ? " (private)" : "")],
    ["status", item.status + (item.duplicate_of ? ` → ${item.duplicate_of}` : "")],
    ["votes", `${item.votes}${item.viewer?.voted ? " (including yours)" : ""}`],
    ["comments", String(item.comment_count)],
    ["by", item.author],
    ["created", item.created_at],
    ["id", item.id],
  ];
  if (item.url) rows.push(["url", requestPageLink(item.url)]);
  ctx.io.stdout(`${keyValues(ctx.io, rows)}\n`);
  if (item.body) ctx.io.stdout(`\n${item.body}\n`);
  if (item.timeline?.length) {
    ctx.io.stdout(`\n${paint(ctx.io, "bold", "Timeline")}\n`);
    for (const event of item.timeline) {
      const what = event.type === "status" ? `${event.from ?? "posted"} → ${event.to}` : event.type === "response" ? "official response" : "linked";
      ctx.io.stdout(`${paint(ctx.io, "dim", event.at)}  ${what}${event.note ? `: ${event.note}` : ""}\n`);
    }
  }
  if (item.comments.length) {
    ctx.io.stdout(`\n${paint(ctx.io, "bold", `Comments (${item.comments.length})`)}\n`);
    for (const comment of item.comments) {
      ctx.io.stdout(`${paint(ctx.io, "dim", `${comment.official ? "[official] " : ""}${comment.author} · ${comment.created_at}`)}\n  ${comment.body}\n`);
    }
  }
  return 0;
}

function printFiled(ctx: CommandContext, result: FiledFeedbackResponse, kind: "feature" | "issue"): number {
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  if (result.created && result.data) {
    const page = result.data.url ? ` ${paint(ctx.io, "underline", requestPageLink(result.data.url))}` : "";
    ctx.io.stdout(`${kind === "issue" ? "Reported (private to you and the team)" : "Requested"}: ${result.data.title}.${page}\n`);
    ctx.io.stdout(`${paint(ctx.io, "dim", "Thanks — you get an email now and at every status change.")}\n`);
    return 0;
  }
  ctx.io.stdout(`Not filed: ${result.similar.length} similar item(s) already exist.\n`);
  printList(ctx, result.similar, "");
  ctx.io.stdout(`\n${paint(ctx.io, "dim", `Upvote the one that matches: car-image feedback upvote <id>. None of them? Add --force.`)}\n`);
  return 0;
}

async function request(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const title = ctx.args.positionals.slice(1).join(" ").trim();
  if (!title) throw new CliError("Provide a title", 2, 'Example: car-image feedback request "Interior views" --details "dashboard and seats"');
  const result = await ctx.clientContext.client.requestFeature({ title, body: flagString(ctx.args.flags, "details"), force: flagBoolean(ctx.args.flags, "force") });
  return printFiled(ctx, result, "feature");
}

interface LastError {
  request_id: string | null;
  command: string;
  status: number;
  error_code: string | null;
}

/** The failure `car-image` remembered last (see main.ts). */
export async function readLastError(path: string): Promise<LastError | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as LastError;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function report(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const title = ctx.args.positionals.slice(1).join(" ").trim();
  if (!title) throw new CliError("Say what went wrong in a line", 2, 'Example: car-image feedback report "Side view of the 2024 Camry returns 502" --last');
  const { flags } = ctx.args;
  const context: IssueContext = { client: "car-image-cli", client_version: CLI_VERSION };
  let requestId = flagString(flags, "request-id");
  if (flagBoolean(flags, "last") && !requestId) {
    const last = await readLastError(lastErrorPath(ctx.env));
    if (!last) throw new CliError("No failed request remembered yet", 2, "Pass --request-id <id> from the error, or run the failing command once more.");
    requestId = last.request_id ?? undefined;
    context.endpoint = `car-image ${last.command}`;
    context.status = last.status;
    if (last.error_code) context.error_code = last.error_code;
  }
  const result = await ctx.clientContext.client.reportIssue({ title, body: flagString(flags, "details"), requestId, context, force: flagBoolean(flags, "force"), attachLastError: false });
  return printFiled(ctx, result, "issue");
}

function printImageReport(ctx: CommandContext, result: ImageReportResponse, filed: boolean): number {
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  const report = result.data;
  if (filed) {
    ctx.io.stdout(`${result.created === false ? "Added to your open report" : "Reported"} (${report.status}${report.report_count > 1 ? `, ${report.report_count} reports` : ""}).\n`);
  }
  const vehicle = `${report.vehicle.year} ${report.vehicle.make} ${report.vehicle.model}`;
  const rows: Array<[string, string]> = [
    ["type", report.type + (report.category ? ` (${report.category})` : "")],
    ["status", report.status],
    ["vehicle", vehicle + (report.view ? `, ${report.view}` : "") + (report.color ? `, ${report.color}` : "")],
    ["id", report.id],
    ["url", report.url],
  ];
  if (report.external_ref) rows.push(["your ref", report.external_ref]);
  if (report.resolved_at) rows.push(["resolved", `${report.resolved_at}${report.resolution ? ` (${report.resolution})` : ""}`]);
  ctx.io.stdout(`${keyValues(ctx.io, rows)}\n`);
  if (filed) ctx.io.stdout(`${paint(ctx.io, "dim", "The page is private to your account. Check it later: car-image feedback report-image show <id>")}\n`);
  return 0;
}

async function reportImage(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { flags } = ctx.args;
  if (ctx.args.positionals[1]?.toLowerCase() === "show") {
    const id = ctx.args.positionals[2]?.trim();
    if (!id) throw new CliError("Missing report id", 2, "Example: car-image feedback report-image show <id> — the id is printed when the report is filed.");
    return printImageReport(ctx, await ctx.clientContext.client.getImageReport(id), false);
  }
  const type = flagChoice(flags, "type", IMAGE_REPORT_TYPES);
  const category = flagChoice(flags, "category", IMAGE_REPORT_CATEGORIES);
  const common = { reason: flagString(flags, "reason"), externalRef: flagString(flags, "ref") };
  const make = flagString(flags, "make");
  const model = flagString(flags, "model");
  const year = flagString(flags, "year");
  let input: ImageReportInput;
  if (type === "missing_vehicle") {
    if (!make || !model || !year) throw new CliError("A missing vehicle needs --make, --model and --year", 2, "Example: car-image feedback report-image --type missing_vehicle --make Rivian --model R3 --year 2026");
    input = { type, make, model, year, ...common };
  } else {
    const image = { type, category, ...common };
    const requestId = flagString(flags, "request-id");
    const assetId = flagString(flags, "asset-id");
    const vehicle = flagString(flags, "vehicle")?.trim();
    if (assetId) input = { ...image, assetId };
    else if (requestId) input = { ...image, requestId };
    else if (vehicle) input = { ...image, vehicle, view: flagView(flags), color: flagColor(flags) };
    else if (make && model && year) input = { ...image, make, model, year, view: flagView(flags), color: flagColor(flags) };
    else {
      throw new CliError(
        "Identify the image with --request-id, --asset-id, --vehicle, or --make, --model and --year",
        2,
        'Example: car-image feedback report-image --request-id req_01JD7X2Q --category identity --reason "Shows the previous generation". For a vehicle the catalog lacks: --type missing_vehicle.'
      );
    }
  }
  return printImageReport(ctx, await ctx.clientContext.client.reportImage(input), true);
}

async function upvote(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const id = requireId(ctx, "upvote");
  const remove = flagBoolean(ctx.args.flags, "remove");
  const result = remove ? await ctx.clientContext.client.removeFeedbackVote(id) : await ctx.clientContext.client.upvoteFeedback(id);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  ctx.io.stdout(`${remove ? "Vote removed from" : "Upvoted"} ${requestLabel(result.data)} — ${votesLabel(result.data.votes)}.\n`);
  return 0;
}

async function comment(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const id = requireId(ctx, "comment");
  const text = ctx.args.positionals.slice(2).join(" ").trim();
  if (!text) throw new CliError("Provide the comment text", 2, 'Example: car-image feedback comment <id> "Also the hybrid trim, please"');
  const result = await ctx.clientContext.client.commentOnFeedback(id, text);
  if (ctx.io.json) {
    printJson(ctx.io, result);
    return 0;
  }
  ctx.io.stdout(`Comment added to ${result.data.request_id}.\n`);
  return 0;
}

export const feedbackCommand: CommandDefinition = {
  name: "feedback",
  summary: "Request features, report issues with the request attached, report a wrong image or a missing vehicle, upvote and comment (free)",
  usage: USAGE,
  async run(ctx: CommandContext): Promise<number> {
    const { flags } = ctx.args;
    const action = ctx.args.positionals[0]?.toLowerCase();
    if (!action && (flags.rating !== undefined || flags.good === true || flags.bad === true)) {
      throw new CliError("Image ratings were replaced by image reports", 2, 'Use: car-image feedback report-image --request-id <id> --category identity|camera|paint|quality --reason "..."');
    }
    switch (action ?? "list") {
      case "list":
        return list(ctx, false);
      case "mine":
        return list(ctx, true);
      case "show":
        return show(ctx);
      case "request":
        return request(ctx);
      case "report":
        return report(ctx);
      case "report-image":
        return reportImage(ctx);
      case "upvote":
        return upvote(ctx);
      case "comment":
        return comment(ctx);
      default:
        throw new CliError(`Unknown feedback action "${action}"`, 2, `Use one of: ${SUBCOMMANDS.join(", ")}. Run \`car-image feedback --help\` for usage.`);
    }
  },
};

function printReview(ctx: CommandContext, review: OwnReview): void {
  const rows: Array<[string, string]> = [
    ["rating", `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`],
    ["status", review.status],
    ["name", review.display_name],
  ];
  if (review.title) rows.push(["title", review.title]);
  if (review.response) rows.push(["our reply", review.response.body]);
  ctx.io.stdout(`${keyValues(ctx.io, rows)}\n`);
}

export const reviewCommand: CommandDefinition = {
  name: "review",
  summary: "Post or edit your public review of Car Image (free); with no flags, show yours",
  usage:
    'car-image review [--rating 1-5] [--title "..."] [--body "..."] [--likes "..."] [--dislikes "..."] [--use-case "..."] [--name "..."] [--company "..."] [--quote-ok]',
  async run(ctx: CommandContext): Promise<number> {
    requireSignIn(ctx);
    const { flags } = ctx.args;
    const rating = flagInteger(flags, "rating", { min: 1, max: 5 });
    if (rating === undefined) {
      const mine = await ctx.clientContext.client.getMyReview();
      if (ctx.io.json) {
        printJson(ctx.io, mine);
        return 0;
      }
      if (!mine.data) {
        ctx.io.stdout('No review yet. Write one: car-image review --rating 5 --body "What it does for you"\n');
        return 0;
      }
      printReview(ctx, mine.data);
      return 0;
    }
    const result = await ctx.clientContext.client.submitReview({
      rating,
      title: flagString(flags, "title"),
      body: flagString(flags, "body"),
      likes: flagString(flags, "likes"),
      dislikes: flagString(flags, "dislikes"),
      use_case: flagString(flags, "use-case"),
      display_name: flagString(flags, "name"),
      display_company: flagString(flags, "company"),
      marketing_consent: flagBoolean(flags, "quote-ok"),
    });
    if (ctx.io.json) {
      printJson(ctx.io, result);
      return 0;
    }
    ctx.io.stdout(`${result.created ? "Thanks for the review" : "Review updated"}.\n`);
    if (result.data) printReview(ctx, result.data);
    if (result.data?.status === "pending") ctx.io.stdout(`${paint(ctx.io, "dim", "It shows on carimage.dev/reviews after a quick check.")}\n`);
    return 0;
  },
};

export const reviewsCommand: CommandDefinition = {
  name: "reviews",
  summary: "Read the public reviews of Car Image and the team's answers",
  usage: "car-image reviews [--sort newest|highest|lowest] [--rating 1-5] [--limit 20] [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const { flags } = ctx.args;
    const result = await ctx.clientContext.client.listReviews({
      sort: flagChoice(flags, "sort", ["newest", "highest", "lowest"] as const),
      rating: flagInteger(flags, "rating", { min: 1, max: 5 }),
      limit: flagInteger(flags, "limit", { min: 1, max: 100 }),
      cursor: flagString(flags, "cursor"),
    });
    if (ctx.io.json) {
      printJson(ctx.io, result);
      return 0;
    }
    const { summary } = result;
    ctx.io.stdout(summary.count === 0 ? "No reviews yet.\n" : `${summary.count} review(s), average ${summary.average} of 5.\n\n`);
    for (const review of result.data) {
      ctx.io.stdout(`${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}  ${paint(ctx.io, "bold", review.title ?? "")} ${paint(ctx.io, "dim", `— ${review.display_name}, ${review.created_at.slice(0, 10)}`)}\n`);
      if (review.body) ctx.io.stdout(`  ${review.body}\n`);
      if (review.response) ctx.io.stdout(`  ${paint(ctx.io, "dim", `Car Image: ${review.response.body}`)}\n`);
      ctx.io.stdout("\n");
    }
    return 0;
  },
};
