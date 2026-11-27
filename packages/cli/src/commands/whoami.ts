import { CREDITS_PER_DOLLAR } from "@meterapp/car-image-sdk";

import { maskKey } from "../config.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { flagString } from "../args.js";
import { creditsToUsd, formatInteger, keyValues, printJson, table } from "../output.js";

/** What each plan's license means, in one line (/terms#license). */
const LICENSE_LINES: Record<string, string> = {
  evaluation: "evaluation and personal projects; a paid plan carries the commercial license",
  commercial: "commercial license while subscribed; delete stored copies within 30 days after it ends",
  "commercial+export": "commercial license, plus export or a catalog copy by written agreement",
};

export const whoamiCommand: CommandDefinition = {
  name: "whoami",
  aliases: ["status", "account"],
  summary: "Show the organization, plan and license, this month's vehicle images, credits, key and base URL for the current account",
  usage:
    "car-image whoami [--json]\n" +
    "car-image whoami campaigns [--from <date>] [--to <date>] [--json]\n" +
    "  campaigns: campaign tracking (the --campaign and --pieces of get and url) over [from, to): pieces, requests and loads by campaign,\n" +
    "  and the vehicles each campaign used. --from defaults to the start of this UTC month, --to to now; a date (2026-11-01) or an ISO timestamp,\n" +
    "  at most 400 days apart. Free; needs the account:read scope",
  async run(ctx: CommandContext): Promise<number> {
    const { io, clientContext } = ctx;
    if (!clientContext.apiKey) {
      throw new CliError("Not signed in.", 1, "Run `car-image login` or set CAR_IMAGE_API_KEY.");
    }
    const sub = ctx.args.positionals[0];
    if (sub === "campaigns") return runCampaigns(ctx);
    if (sub !== undefined) throw new CliError(`Unknown whoami command "${sub}". Use campaigns, or no subcommand for the account.`, 2);
    const account = await clientContext.client.account();
    if (io.json) {
      printJson(io, { ...account, key_source: clientContext.keySource, base_url: clientContext.baseUrl });
      return 0;
    }
    const data = account.data;
    const perDollar = data.pricing?.credits_per_dollar ?? CREDITS_PER_DOLLAR;
    const usage = data.usage_30d;
    const org = data.organization;
    const limits = data.limits_usage;
    // The vehicle-image meter (plans since 2026-10-25): images cost no credits, which pay only for 3D models, logos and upgrades.
    const metered = limits?.meter === "vehicle_images" || data.plan?.meter === "vehicle_images";
    const rows: Array<[string, string]> = [
      ...(org ? ([["Organization", `${org.name}${org.personal ? " (personal)" : ""}${org.role ? ` · you are ${org.role}` : ""}`]] as Array<[string, string]>) : []),
      metered
        ? ["Credits", `${formatInteger(data.credits)}  (for 3D models, make logos and upgrades; images use the plan's allowance)`]
        : ["Credits", `${formatInteger(data.credits)}  (≈ ${creditsToUsd(data.credits, perDollar)}; ${formatInteger(data.pricing?.credits_per_image ?? 1)} credit per image)`],
      ...(metered ? [] : ([["Auto-reload", data.auto_reload ? "on" : "off"]] as Array<[string, string]>)),
      ["Payment method", data.has_payment_method ? "on file" : "none"],
    ];
    if (data.plan) rows.push(["Plan", `${data.plan.name}${data.plan.active ? "" : " (inactive)"}  (${LICENSE_LINES[data.plan.license] ?? data.plan.license})`]);
    if (limits) {
      const resets = `(resets ${limits.period.resets_at.slice(0, 10)})`;
      const of = (usage: { used: number; limit: number | null }, what: string) =>
        `${formatInteger(usage.used)}${usage.limit === null ? ` ${what} this month (no cap)` : ` of ${formatInteger(usage.limit)} ${what} this month`}`;
      // Free counts one allowance per account (vehicle_images_total, since 2026-11-11); nothing resets it.
      const total = limits.vehicle_images_total;
      if (total) rows.push(["Vehicle images", `${formatInteger(total.used)}${total.limit === null ? " free vehicle images (no cap)" : ` of ${formatInteger(total.limit)} free vehicle images`}  (per account, not per month)`]);
      else if (limits.vehicle_images_this_month) rows.push(["Vehicle images", `${of(limits.vehicle_images_this_month, "vehicle images")}  ${resets}`]);
      if (limits.distinct_vehicles_this_month) rows.push(["Vehicles", `${of(limits.distinct_vehicles_this_month, "distinct vehicles").replace("distinct vehicles this month", "distinct this month")}  ${resets}`]);
      rows.push(["Keys", `${formatInteger(limits.api_keys.used)} of ${formatInteger(limits.api_keys.limit ?? 0)} · ${formatInteger(limits.requests_per_minute_per_key)} requests/min per key`]);
    }
    if (data.renews_at) rows.push(["Renews", data.renews_at.slice(0, 10)]);
    if (usage) {
      const hitRate = Number.isFinite(usage.cache_hit_rate) ? `${Math.round(usage.cache_hit_rate * (usage.cache_hit_rate <= 1 ? 100 : 1))}% cache hits` : "";
      rows.push(["Usage (30d)", `${formatInteger(usage.requests)} requests, ${formatInteger(usage.images)} images${hitRate ? `, ${hitRate}` : ""}`]);
    }
    rows.push(["Key", `${data.key?.prefix ? `${data.key.prefix}…` : maskKey(clientContext.apiKey)}  (${clientContext.keySource ?? "unknown"} · scopes: ${(data.key?.scopes ?? []).join(", ") || "—"})`]);
    rows.push(["Base URL", clientContext.baseUrl]);
    rows.push(["Config", ctx.configPath]);
    io.stdout(`${keyValues(io, rows)}\n`);
    if (data.next_plan) {
      const price = data.next_plan.price.monthly === null ? "custom pricing" : `$${data.next_plan.price.monthly}/month`;
      io.stdout(`\nNext plan: ${data.next_plan.name} (${price}): ${data.next_plan.adds.join("; ")}. car-image upgrade --plan ${data.next_plan.id}\n`);
    }
    const full = (usage: { used: number; limit: number | null } | null | undefined) => Boolean(usage && usage.limit !== null && usage.used >= usage.limit);
    if (metered && full(limits?.vehicle_images_this_month)) {
      io.stdout(`\nThe vehicle-image allowance is used up for this month: images already received keep serving; new ones wait for the reset, a higher plan (car-image upgrade --plan …) or an Image Pack (car-image packs).\n`);
    } else if (!metered && data.credits < 10) {
      io.stdout(`\nLow balance. Credits are no longer sold; a plan includes vehicle images and credits every month: car-image upgrade --plan pro (${clientContext.baseUrl}/dashboard?ref=cli#plan)\n`);
    }
    return 0;
  },
};

/** `car-image whoami campaigns`: GET /api/v1/account/campaigns as two tables. */
async function runCampaigns(ctx: CommandContext): Promise<number> {
  const { io, clientContext } = ctx;
  const from = flagString(ctx.args.flags, "from");
  const to = flagString(ctx.args.flags, "to");
  const result = await clientContext.client.getCampaignUsage({ ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
  if (io.json) {
    printJson(io, result);
    return 0;
  }
  const data = result.data;
  const totals = data.totals;
  io.stdout(
    `Campaigns ${data.from.slice(0, 10)} to ${data.to.slice(0, 10)}: ${formatInteger(totals.pieces)} pieces over ${formatInteger(totals.requests)} tagged requests, ` +
      `${formatInteger(totals.campaigns)} campaign${totals.campaigns === 1 ? "" : "s"}, ${formatInteger(totals.loads)} loads of tagged URLs\n`
  );
  if (data.by_campaign.length === 0) {
    if (!io.quiet) io.stdout("\nNo tagged requests in this window. Tag one with car-image get or url --campaign <label> --pieces <count>.\n");
    return 0;
  }
  io.stdout(
    `\n${table(
      data.by_campaign.map((row) => [row.campaign ?? "(no campaign)", formatInteger(row.pieces), formatInteger(row.requests), formatInteger(row.loads)]),
      ["Campaign", "Pieces", "Requests", "Loads"]
    )}\n`
  );
  if (data.by_vehicle.length) {
    io.stdout(
      `\n${table(
        data.by_vehicle.map((row) => [`${row.year} ${row.make} ${row.model}`, row.vehicle_id ?? "", formatInteger(row.pieces), row.campaigns.join(", ")]),
        ["Vehicle", "Id", "Pieces", "Campaigns"]
      )}\n`
    );
  }
  if (data.truncated && !io.quiet) io.stderr("Only the 500 largest campaigns and vehicles are listed; narrow --from/--to for the rest.\n");
  return 0;
}
