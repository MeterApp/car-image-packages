import type { AgentPurchaseResponse } from "@meterapp/car-image-sdk";
import { flagBoolean, flagChoice, flagInteger, flagString } from "../args.js";
import { openBrowser } from "../browser.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { printJson } from "../output.js";
export const PAID_PLANS = ["starter", "pro", "business"] as const;

/** Why `--credits` is refused: credits are not sold since 2026-10-25. */
export const CREDITS_NOT_SOLD = "Credits are no longer sold.";
export const CREDITS_NOT_SOLD_HINT =
  "A plan includes vehicle images and credits every month: `car-image upgrade --plan pro` (or business). To own a set of images outright, buy an Image Pack: `car-image packs buy --images 500`.";

export const billingCommand: CommandDefinition = {
  name: "billing",
  aliases: ["upgrade"],
  summary: "Plan checkout and billing links (work before sign-in); pay with a payment token under the owner's agent limit",
  usage: [
    "car-image billing|upgrade --plan pro|business [--yearly] [--wait] [--no-browser] [--json]   a plan's Checkout",
    "car-image billing [--portal] [--no-browser] [--json]   billing settings (signed in) or the plans (signed out)",
    "car-image upgrade --plan pro [--yearly] --payment-token spt_… --max-amount <cents> [--dry-run] [--purchase-id <id>] [--json]",
    "car-image billing pay --invoice in_… --payment-token spt_… --max-amount <cents> [--dry-run] [--purchase-id <id>] [--json]",
    "car-image billing limit [--json]            the owner's monthly agent spending limit",
    "car-image billing set-limit <dollars>       opens the dashboard to confirm a new limit (the owner's browser, never a key)",
    "Credits are not sold: plans include vehicle images and credits; Image Packs (car-image packs) buy a set of images to keep.",
  ].join("\n"),
  async run(ctx: CommandContext): Promise<number> {
    const { io, clientContext } = ctx;
    const sub = ctx.args.positionals[0];
    if (sub === "pay") return payCommand(ctx);
    if (sub === "limit") return limitCommand(ctx);
    if (sub === "set-limit") return setLimitCommand(ctx);
    if (sub !== undefined) throw new CliError(`Unknown billing command "${sub}". Use pay, limit or set-limit, or no subcommand for a link.`, 2);
    // Checked before anything else, so a script that still buys credits stops here and sends nothing.
    if (ctx.args.flags.credits !== undefined) throw new CliError(CREDITS_NOT_SOLD, 2, CREDITS_NOT_SOLD_HINT);
    if (ctx.args.flags.portal === true && ctx.args.flags.plan !== undefined) throw new CliError("Choose one of --portal or --plan.", 2);
    if (ctx.args.flags.yearly === true && ctx.args.flags.plan === undefined) throw new CliError("--yearly requires --plan.", 2);
    if (!clientContext.apiKey && ctx.args.flags.portal === true) throw new CliError("Not signed in.", 1, "Run `car-image login` first.");
    const plan = flagChoice(ctx.args.flags, "plan", PAID_PLANS);
    if (ctx.args.flags.plan !== undefined && !plan) throw new CliError(`Unknown plan. Choose one of: ${PAID_PLANS.join(", ")} (Enterprise: support@carimage.dev)`, 2);
    const interval = flagBoolean(ctx.args.flags, "yearly") ? "year" : "month";
    if (ctx.args.flags["payment-token"] !== undefined) {
      if (!plan) throw new CliError("--payment-token buys a plan: add --plan pro or --plan business.", 2);
      return purchaseCommand(ctx, plan, interval);
    }
    if (!clientContext.apiKey) return plan ? publicCheckout(ctx, plan, interval) : publicPlans(ctx);
    const result = plan
      ? await clientContext.client.createCheckoutLink({ plan, interval })
      : await clientContext.client.getBillingLink();
    const wait = flagBoolean(ctx.args.flags, "wait") && Boolean(result.data.session_id);
    if (io.json && !wait) { printJson(io, result); return 0; }
    if (!io.json) {
      if (result.data.amount_cents !== undefined) io.stdout(`$${(result.data.amount_cents / 100).toFixed(2)} per ${interval}\n`);
      io.stdout(`${result.data.message}\n  ${result.data.url}\n`);
    }
    if (ctx.args.flags.browser !== false) openBrowser(result.data.url);
    if (wait) return waitForCheckout(ctx, result.data.session_id!);
    return 0;
  },
};

/** Polls a Checkout session until it completes or expires (agent cards and Link pay in the browser). */
async function waitForCheckout(ctx: CommandContext, sessionId: string, intervalMs = 3_000, timeoutMs = 30 * 60_000): Promise<number> {
  const started = Date.now();
  for (;;) {
    const status = await ctx.clientContext.client.checkoutStatus(sessionId);
    if (status.data.complete || status.data.status === "expired") {
      if (ctx.io.json) printJson(ctx.io, status);
      else ctx.io.stdout(status.data.complete ? "Checkout complete. Run `car-image account` to see the plan.\n" : "Checkout expired before it was paid.\n");
      return status.data.complete ? 0 : 1;
    }
    if (Date.now() - started > timeoutMs) throw new CliError("Still waiting for Checkout after 30 minutes.", 1, `Check later with GET /api/v1/billing/checkout/${sessionId}.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function tokenFlags(ctx: CommandContext): { paymentToken: string; maxAmount: number | undefined; dryRun: boolean; idempotencyKey: string | undefined } {
  const paymentToken = flagString(ctx.args.flags, "payment-token") ?? "";
  if (!/^spt_[A-Za-z0-9_]{8,255}$/.test(paymentToken)) throw new CliError("--payment-token must be a Stripe Shared Payment Token (spt_…) from the agent platform. Never pass a card number.", 2);
  const maxAmount = flagInteger(ctx.args.flags, "max-amount", { min: 0 });
  const dryRun = flagBoolean(ctx.args.flags, "dry-run");
  if (maxAmount === undefined && !dryRun) throw new CliError("--max-amount <cents> is required for a purchase: run with --dry-run first to see the amount.", 2);
  return { paymentToken, maxAmount, dryRun, idempotencyKey: flagString(ctx.args.flags, "purchase-id") };
}

function printPurchase(ctx: CommandContext, result: AgentPurchaseResponse): number {
  if (ctx.io.json) { printJson(ctx.io, result); return 0; }
  const data = result.data;
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  if (data.dry_run && data.quote) {
    ctx.io.stdout(`Quote: ${money(data.quote.amount)} on ${data.quote.card ?? "the token's card"}${data.plan ? ` for ${data.plan} (${data.interval}ly)` : ""}. Nothing was charged.\n`);
  } else if (data.charged) {
    ctx.io.stdout(`${data.replayed ? "Already paid (replayed): " : "Paid "}${money(data.charged.amount)} on ${data.charged.card ?? "card"}${data.plan ? ` for ${data.plan} (${data.interval}ly)` : ""}.\n`);
    if (data.receipt_url) ctx.io.stdout(`Receipt: ${data.receipt_url}\n`);
    if (data.renewal) ctx.io.stdout(`Renewal: ${money(data.renewal.amount)}${data.renewal.on ? ` on ${data.renewal.on}` : ""}. ${data.renewal.how}\n`);
  }
  const spend = data.agent_spend;
  if (spend.limit !== null) ctx.io.stdout(`Agent spending this month: ${money(spend.used_this_month)} of ${money(spend.limit)}.\n`);
  return 0;
}

async function purchaseCommand(ctx: CommandContext, plan: (typeof PAID_PLANS)[number], interval: "month" | "year"): Promise<number> {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login`, then ask the owner to allow agent purchases for the key in the dashboard.");
  const flags = tokenFlags(ctx);
  return printPurchase(ctx, await ctx.clientContext.client.purchasePlan({ plan, interval, ...flags }));
}

async function payCommand(ctx: CommandContext): Promise<number> {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` first.");
  const invoice = flagString(ctx.args.flags, "invoice") ?? "";
  if (!/^in_[A-Za-z0-9]{8,255}$/.test(invoice)) throw new CliError("--invoice must be a Stripe invoice id (in_…), as `car-image account --json` shows under billing.renewal_due.", 2);
  return printPurchase(ctx, await ctx.clientContext.client.payInvoice(invoice, tokenFlags(ctx)));
}

async function limitCommand(ctx: CommandContext): Promise<number> {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, "Run `car-image login` first.");
  const result = await ctx.clientContext.client.agentLimit();
  if (ctx.io.json) { printJson(ctx.io, result); return 0; }
  const data = result.data;
  if (data.limit === null) ctx.io.stdout(`No agent spending limit: agents get checkout links. Set one with \`car-image billing set-limit <dollars>\` or at ${data.manage_url}\n`);
  else ctx.io.stdout(`Agents may spend $${(data.limit / 100).toFixed(2)} a month on ${data.allowed_plans.join(", ") || "no plan"}; $${(data.used_this_month / 100).toFixed(2)} used this month.\n`);
  return 0;
}

/**
 * Opens the dashboard's Let agents buy card with the amount filled in; the
 * owner confirms there, signed in. An API key cannot raise a limit, so the
 * CLI never sends one.
 */
async function setLimitCommand(ctx: CommandContext): Promise<number> {
  const raw = ctx.args.positionals[1];
  const dollars = Number(raw);
  if (raw === undefined || !Number.isFinite(dollars) || dollars < 0 || dollars > 100_000) throw new CliError("Give the monthly limit in dollars, e.g. `car-image billing set-limit 50`.", 2);
  const cents = Math.round(dollars * 100);
  const url = `${ctx.clientContext.baseUrl}/dashboard?ref=cli&agent_limit=${cents}#agent-spend`;
  if (ctx.io.json) printJson(ctx.io, { data: { url, monthly_cents: cents, requires_confirmation: true } });
  else ctx.io.stdout(`Confirm the new agent spending limit of $${(cents / 100).toFixed(2)} a month in your browser (signed in to the dashboard):\n  ${url}\n`);
  if (ctx.args.flags.browser !== false) openBrowser(url);
  return 0;
}

/**
 * Before sign-in: the pricing document's own link (GET /api/v1/pricing, no
 * key), which signs the human in, or up, and then opens Stripe Checkout for
 * the plan. Nothing is charged until they pay there.
 */
async function publicCheckout(ctx: CommandContext, plan: (typeof PAID_PLANS)[number], interval: "month" | "year"): Promise<number> {
  const { io, clientContext } = ctx;
  const pricing = await clientContext.client.pricing();
  const entry = pricing.data.plans.find((candidate) => candidate.id === plan);
  const url = entry ? (interval === "year" ? entry.checkout_url_yearly : entry.checkout_url) : null;
  if (!entry || !url) throw new CliError("This server's pricing has no checkout link for that plan.", 1, "Run `car-image login`, then try again.");
  const amount = interval === "year" ? entry.price.yearly : entry.price.monthly;
  const message = "Not signed in: this link signs you in (or up), then opens Stripe Checkout. Nothing is charged until you pay there.";
  if (io.json) {
    printJson(io, { data: { url, kind: "checkout", requires_confirmation: true, signed_in: false, plan, interval, amount_cents: Math.round((amount ?? 0) * 100), message } });
    return 0;
  }
  io.stdout(`$${(amount ?? 0).toFixed(2)} per ${interval}\n${message}\n  ${url}\n`);
  if (ctx.args.flags.browser !== false) openBrowser(url);
  return 0;
}

/** Before sign-in with no plan named: the plans and where to compare them, since there are no billing settings yet. */
async function publicPlans(ctx: CommandContext): Promise<number> {
  const { io, clientContext } = ctx;
  const url = `${clientContext.baseUrl}/pricing?ref=cli`;
  if (io.json) {
    printJson(io, { data: { url, kind: "pricing", requires_confirmation: true, signed_in: false, message: "Not signed in: compare the plans, then run `car-image upgrade --plan pro|business`." } });
    return 0;
  }
  io.stdout(`Not signed in. Compare the plans, then run \`car-image upgrade --plan pro|business\` (it signs you in first):\n  ${url}\n`);
  if (ctx.args.flags.browser !== false) openBrowser(url);
  return 0;
}
