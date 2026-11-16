import { REFERRAL_SOURCES, type ReferralSource } from "@meterapp/car-image-sdk";
import { flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { printJson } from "../output.js";
import { SIGN_IN_HINT } from "./request.js";

export const SAVED_MESSAGE = "Thanks — saved. Only the Car Image team sees this.";

export const aboutCommand: CommandDefinition = {
  name: "about",
  summary: "Tell the team what you are building and how you found us (private to the Car Image team)",
  usage: ['car-image about building "<what you are building>"', `car-image about referral <${REFERRAL_SOURCES.join("|")}> [--detail "..."]`].join("\n"),
  async run(ctx: CommandContext): Promise<number> {
    const [action, ...rest] = ctx.args.positionals;
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
    switch ((action ?? "").toLowerCase()) {
      case "building": {
        const building = rest.join(" ").trim();
        if (!building) throw new CliError("Tell us what you are building", 2, 'Example: car-image about building "a dealer inventory site for used minivans"');
        const result = await ctx.clientContext.client.shareBuilding(building);
        if (ctx.io.json) {
          printJson(ctx.io, result);
          return 0;
        }
        ctx.io.stdout(`${SAVED_MESSAGE}\n`);
        return 0;
      }
      case "referral": {
        const raw = rest[0]?.trim().toLowerCase().replace(/-/g, "_");
        if (!raw) throw new CliError("Say where you found the API", 2, `Choose one of: ${REFERRAL_SOURCES.join(", ")}`);
        if (!(REFERRAL_SOURCES as readonly string[]).includes(raw)) {
          throw new CliError(`Unknown source "${rest[0]}"`, 2, `Choose one of: ${REFERRAL_SOURCES.join(", ")}`);
        }
        const detail = flagString(ctx.args.flags, "detail") ?? (rest.length > 1 ? rest.slice(1).join(" ") : undefined);
        const result = await ctx.clientContext.client.shareReferral(raw as ReferralSource, detail);
        if (ctx.io.json) {
          printJson(ctx.io, result);
          return 0;
        }
        ctx.io.stdout(`${SAVED_MESSAGE}\n`);
        return 0;
      }
      default:
        throw new CliError(action ? `Unknown about action "${action}"` : "Missing action", 2, "Use `car-image about building \"...\"` or `car-image about referral <source>`. Run `car-image about --help` for usage.");
    }
  },
};
