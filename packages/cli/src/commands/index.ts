import { pricingCommand, supportCommand } from "./support.js";
import type { CommandDefinition } from "../context.js";
import { aboutCommand } from "./about.js";
import { agentConfigCommand, mcpCommand } from "./agents.js";
import { billingCommand } from "./billing.js";
import { optionsCommand, resolveCommand, searchCommand } from "./catalog.js";
import { feedbackCommand, reviewCommand, reviewsCommand } from "./feedback.js";
import { checkCommand } from "./check.js";
import { describeCommand } from "./describe.js";
import { doctorCommand } from "./doctor.js";
import { helpCommand, type HelpEntry } from "./help.js";
import { getCommand, logoCommand, urlCommand } from "./images.js";
import { loginCommand, logoutCommand } from "./login.js";
import { configCommand, telemetryCommand, updateCommand } from "./maintenance.js";
import { model3dCommand } from "./model3d.js";
import { onboardCommand } from "./onboard.js";
import { packsCommand } from "./packs.js";
import { requestCommand } from "./request.js";
import { vinCommand } from "./vin.js";
import { webhooksCommand } from "./webhooks.js";
import { whoamiCommand } from "./whoami.js";

export const COMMANDS: CommandDefinition[] = [
  loginCommand,
  logoutCommand,
  whoamiCommand,
  doctorCommand,
  getCommand,
  logoCommand,
  urlCommand,
  model3dCommand,
  webhooksCommand,
  packsCommand,
  searchCommand,
  resolveCommand,
  checkCommand,
  vinCommand,
  optionsCommand,
  describeCommand,
  feedbackCommand,
  reviewCommand,
  reviewsCommand,
  requestCommand,
  aboutCommand,
  billingCommand,
  pricingCommand,
  supportCommand,
  mcpCommand,
  agentConfigCommand,
  updateCommand,
  configCommand,
  telemetryCommand,
  onboardCommand,
  helpCommand({ entries: helpEntries, more: moreCommandNames }),
];

/**
 * The six commands `--help` and the README teach, in this order: sign in,
 * fetch an image, mint a URL, find a vehicle, decode a VIN, check the setup.
 * The 2026-09-29 surface audit counted 26 commands and five accounts using the
 * CLI; the rest stay available (`car-image help --all`, `<command> --help`)
 * without a place in the first screen.
 */
export const PRIMARY_COMMANDS = ["login", "get", "url", "search", "vin", "doctor"] as const;

function entryOf({ name, summary, usage, aliases }: CommandDefinition): HelpEntry {
  return { name: aliases?.length ? `${name} (${aliases.join(", ")})` : name, summary, usage };
}

/** `primary`: the six, in their order. `all`: every command but the interactive onboarding, in registry order. */
export function helpEntries(scope: "primary" | "all" = "all"): HelpEntry[] {
  if (scope === "primary") {
    return PRIMARY_COMMANDS.map((name) => entryOf(COMMANDS.find((command) => command.name === name)!));
  }
  return COMMANDS.filter((command) => command.name !== "onboard").map(entryOf);
}

/** The commands `--help` leaves to `help --all`, by name (`help` itself is the line that names them). */
export function moreCommandNames(): string[] {
  return COMMANDS.filter(
    (command) => command.name !== "onboard" && command.name !== "help" && !(PRIMARY_COMMANDS as readonly string[]).includes(command.name)
  ).map((command) => command.name);
}

export function findCommand(name: string): CommandDefinition | undefined {
  const needle = name.toLowerCase();
  return COMMANDS.find((command) => command.name === needle || command.aliases?.includes(needle));
}
