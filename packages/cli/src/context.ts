import type { TelemetryEvent } from "@meterapp/car-image-sdk";
import type { ParsedArgs } from "./args.js";
import type { ClientContext } from "./client.js";
import type { CliConfig, Env } from "./config.js";
import type { FixHint } from "./errors.js";
import type { Io } from "./output.js";

export interface TelemetryState {
  enabled: boolean;
  anonymousId: string | null;
}

export interface CommandContext {
  args: ParsedArgs;
  io: Io;
  env: Env;
  config: CliConfig;
  configPath: string;
  clientContext: ClientContext;
  telemetry: TelemetryState;
  /** Queue an extra telemetry event to be sent with the command's `cli_command` event. */
  emit(event: TelemetryEvent): void;
  /** Runs another command with fresh arguments (used by onboarding). */
  runCommand(name: string, argv: string[]): Promise<number>;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  summary: string;
  usage: string;
  /** The hint under an API error this command throws; `fixHintFor` when absent. */
  fixHint?: FixHint;
  run(ctx: CommandContext): Promise<number>;
}
