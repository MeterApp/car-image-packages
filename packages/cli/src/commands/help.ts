import type { CommandContext, CommandDefinition } from "../context.js";
import { BIN_NAME, CLI_VERSION, PACKAGE_NAME } from "../version.js";

export interface HelpEntry {
  name: string;
  summary: string;
  usage: string;
}

/**
 * Help for one command (when `command` names one of `entries`) or the command
 * list. `more` names the commands the list leaves out: the first screen shows
 * the six primary commands and one line pointing at `help --all` for the rest.
 */
export function helpText(entries: HelpEntry[], command?: string | null, more: readonly string[] = []): string {
  if (command) {
    // Entries of aliased commands are listed as "3d (model3d)"; match on the bare name too.
    const entry = entries.find((candidate) => candidate.name === command || candidate.name.split(" ")[0] === command);
    if (entry) {
      return `${BIN_NAME} ${entry.name} — ${entry.summary}\n\nUsage:\n  ${entry.usage.split("\n").join("\n  ")}\n\nGlobal options: --json --quiet --base-url <url> --api-key <key> --no-color -h/--help -v/--version\n`;
    }
  }
  const width = Math.max(...entries.map((entry) => entry.name.length));
  const commands = entries.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`).join("\n");
  const moreLine = more.length > 0 ? `\n\nMore: ${BIN_NAME} help --all   (${more.length} more: ${more.join(", ")})` : "";
  return `${BIN_NAME} ${CLI_VERSION} — Car Image API by Meter (${PACKAGE_NAME})
Studio-quality, transparent-background renders of any vehicle in any paint color. Plans count vehicle images (a vehicle in one color from one angle, once a month, any size); Free has 100 a month.
Also: make logos (1 credit; car-image logo), stable vehicle ids (--vehicle veh_…), free VIN decoding, and textured 3D models (100 credits each).

Usage:
  ${BIN_NAME}                      interactive onboarding (login, account, quick check)
  ${BIN_NAME} <command> [options]

Commands:
${commands}${moreLine}

Global options:
  --json               machine-readable output on stdout
  --quiet, -q          only errors and essential output
  --base-url <url>     API origin (default https://carimage.dev; env CAR_IMAGE_API_URL)
  --api-key <key>      override the stored key for this run (env CAR_IMAGE_API_KEY)
  --no-color           disable colors (env NO_COLOR)
  -h, --help           show help (also \`${BIN_NAME} <command> --help\`)
  -v, --version        print the version

Environment:
  CAR_IMAGE_API_KEY    API key (takes priority over the saved credential)
  CAR_IMAGE_API_URL    API origin
  CAR_IMAGE_CONFIG     path to config.json (default $XDG_CONFIG_HOME/car-image-api/config.json)
  CAR_IMAGE_TELEMETRY  set to 0 to disable anonymous usage events

Examples:
  ${BIN_NAME} login
  ${BIN_NAME} get --make Porsche --model 911 --year 2024 --view side --color red --out porsche.png
  ${BIN_NAME} get --vehicle veh_395yw8tn73ff8 --color 1a2b3c --out custom-paint.png
  ${BIN_NAME} url --make BMW --model M3 --year 2022 --ttl 86400
  ${BIN_NAME} search porsche 911
  ${BIN_NAME} vin 1HGCM82633A004352
  ${BIN_NAME} doctor --yes

Exit codes: 0 ok, 1 failure, 2 usage error. Docs: https://carimage.dev/docs?ref=cli
`;
}

export function helpCommand(registry: { entries: (scope: "primary" | "all") => HelpEntry[]; more: () => string[] }): CommandDefinition {
  return {
    name: "help",
    summary: "Show help: the main commands, one command, or --all of them",
    usage: "car-image help [command] [--all]",
    async run(ctx: CommandContext): Promise<number> {
      const command = ctx.args.positionals[0] ?? null;
      if (command) ctx.io.stdout(helpText(registry.entries("all"), command));
      else if (ctx.args.flags.all === true) ctx.io.stdout(helpText(registry.entries("all")));
      else ctx.io.stdout(helpText(registry.entries("primary"), null, registry.more()));
      return 0;
    },
  };
}
