import type { CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { printJson, table } from "../output.js";
export const pricingCommand: CommandDefinition = {
  name: "pricing", summary: "Plans (vehicle images a month), Image Packs, 3D cost and checkout links (free, no key needed)", usage: "car-image pricing [--json]",
  async run(ctx) {
    const result = await ctx.clientContext.client.pricing();
    if (ctx.io.json) printJson(ctx.io, result);
    else {
      const count = (value: number | null | undefined, fallback: string) => (value === null ? "custom" : value === undefined ? fallback : value.toLocaleString("en-US"));
      ctx.io.stdout(table(result.data.plans.map((plan) => [
        plan.name,
        plan.monthly_cents === null ? "custom" : `$${plan.monthly_cents / 100}`,
        plan.yearly_cents === null ? "custom" : `$${plan.yearly_cents / 100}`,
        count(plan.included.vehicle_images_per_month ?? plan.images_per_month, "—"),
        plan.included_credits.toLocaleString("en-US"),
        plan.license,
      ]), ["Plan", "Monthly", "Yearly", "Vehicle images/mo", "Credits/mo", "License"]) + "\n");
      const unit = result.data.usage_unit;
      if (unit.vehicle_image) ctx.io.stdout(`\nA vehicle image: ${unit.vehicle_image}\n`);
      if (unit.not_prepared_yet) ctx.io.stdout(`Not prepared yet: ${unit.not_prepared_yet}\n`);
      ctx.io.stdout(`${result.data.free_signup_credits} signup credits · ${result.data.credits_per_model} credits/3D model · no overage; credits are not sold\n`);
      const packs = result.data.add_ons.filter((addOn) => typeof addOn.images === "number");
      if (packs.length) ctx.io.stdout(`Image Packs (one-time, self-host for good): ${packs.map((pack) => `${pack.images!.toLocaleString("en-US")} ${pack.quality ?? ""} $${pack.price.toLocaleString("en-US")}`.replace("  ", " ")).join(", ")} · car-image packs buy --images <n>\n`);
      if (result.data.notes?.length) ctx.io.stdout(`${result.data.notes.join("\n")}\n`);
      const links = (result.data.plans ?? []).filter((plan) => plan.checkout_url && (plan.id === "pro" || plan.id === "business"));
      if (links.length) ctx.io.stdout(`\nBuy (works before sign-in; nothing is charged until you pay in Stripe Checkout): car-image upgrade --plan pro|business [--yearly]\n${links.map((plan) => `  ${plan.name}: ${plan.checkout_url}`).join("\n")}\n`);
    }
    return 0;
  },
};
export const supportCommand: CommandDefinition = {
  name: "support", summary: "Search source-linked product help (questions recorded privately; no secrets)", usage: 'car-image support "Can I host images on my CDN?" [--report-gap] [--json]',
  async run(ctx) {
    const query = ctx.args.positionals.join(" ").trim();
    if (!query) throw new CliError("Provide a product question. Do not include secrets or personal information.", 2);
    const result = await ctx.clientContext.client.searchHelp(query, { reportGap: ctx.args.flags["report-gap"] === true });
    if (ctx.io.json) printJson(ctx.io, result);
    else {
      ctx.io.stdout(`${result.data.guidance}\n\n`);
      for (const article of result.data.articles) ctx.io.stdout(`${article.title}\n${article.paragraphs.join("\n\n")}\n${article.url}\nSources: ${article.sources.map((source) => source.url).join(" ")}\n\n`);
      if (!result.data.articles.length) ctx.io.stdout(`No matching article yet. Contact ${result.data.support}.\n`);
      if (!result.data.query_recorded) ctx.io.stderr("The question could not be recorded for documentation follow-up.\n");
    }
    return 0;
  },
};
