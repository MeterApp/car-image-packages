import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isCarImageError, type FetchLike, type TelemetryEvent } from "@meterapp/car-image-sdk";
import { parseArgs, type ParsedArgs } from "./args.js";
import { createClientContext } from "./client.js";
import { COMMANDS, findCommand, helpEntries, moreCommandNames } from "./commands/index.js";
import { helpText } from "./commands/help.js";
import { DEFAULT_AUTO_UPDATE, configPath as resolveConfigPath, lastErrorPath, readConfig, updateCachePath, updateConfig, updateLockPath, updateLogPath, type CliConfig, type Env } from "./config.js";
import type { CommandContext, CommandDefinition, TelemetryState } from "./context.js";
import { describeError, type FixHint } from "./errors.js";
import { createIo, paint, type Io } from "./output.js";
import { confirm } from "./prompts.js";
import { TELEMETRY_DISCLOSURE, commandEvent, newAnonymousId, sendEvents, simpleEvent, telemetryEnabled } from "./telemetry.js";
import { detectInstall, markAnnounced, markNoticeShown, planUpdate, readUpdateCache, registryUrl, runBackgroundUpdate, runInstall, spawnBackgroundUpdate, updateChecksDisabled, updateLockHeld } from "./update.js";
import { CLI_VERSION } from "./version.js";

export interface MainDeps {
  env?: Env;
  fetch?: FetchLike;
  /** Overrides for tests (non-TTY, captured output). */
  io?: Partial<Io>;
  /** Disable the update check and the background update (tests). */
  skipUpdateCheck?: boolean;
}

export function renderError(error: unknown, io: Io, hintFor?: FixHint): number {
  const described = describeError(error, hintFor);
  if (io.json) {
    io.stdout(`${JSON.stringify({ error: { message: described.message, hint: described.hint ?? null, request_id: described.requestId ?? null, status: described.status ?? null } }, null, 2)}\n`);
  } else {
    io.stderr(`${paint(io, "red", "✗")} ${described.message}\n`);
    if (described.hint) io.stderr(`  ${paint(io, "yellow", "→")} ${described.hint}\n`);
    if (described.requestId) io.stderr(`  ${paint(io, "dim", `request id: ${described.requestId}`)}\n`);
    if (described.requestId && (described.status ?? 0) >= 500) {
      io.stderr(`  ${paint(io, "dim", 'Looks like our bug? Report it with the request attached: car-image feedback report "<what went wrong>" --last')}\n`);
    }
  }
  return described.exitCode;
}

/** Remembers a failed API call so `car-image feedback report --last` can attach it. Best effort, never fails the command. */
async function rememberFailure(error: unknown, command: string, env: Env): Promise<void> {
  if (!isCarImageError(error) || command === "feedback") return;
  const code = (error.problem as { code?: unknown } | null)?.code;
  const record = { request_id: error.requestId, command, status: error.status, error_code: typeof code === "string" ? code : null, message: `${error.title}: ${error.detail}`.slice(0, 300), at: new Date().toISOString() };
  const path = lastErrorPath(env);
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }).catch(() => undefined);
}

async function setupTelemetry(config: CliConfig, cfgPath: string, env: Env, io: Io, commandName: string): Promise<{ state: TelemetryState; events: TelemetryEvent[] }> {
  if (!telemetryEnabled(config, env)) return { state: { enabled: false, anonymousId: null }, events: [] };
  const events: TelemetryEvent[] = [];
  const patch: Partial<CliConfig> = {};
  let anonymousId = config.anonymousId ?? null;
  if (!anonymousId) {
    anonymousId = newAnonymousId();
    patch.anonymousId = anonymousId;
    events.push(simpleEvent(anonymousId, "cli_install", { command: commandName }));
  }
  if (!config.telemetryDisclosed && commandName !== "mcp") {
    if (!io.quiet) io.stderr(`${paint(io, "dim", TELEMETRY_DISCLOSURE)}\n`);
    patch.telemetryDisclosed = true;
  }
  if (Object.keys(patch).length) {
    await updateConfig(patch, cfgPath).catch(() => undefined);
  }
  return { state: { enabled: true, anonymousId }, events };
}

/**
 * The update step of every command but `update`, from the cache alone: starts
 * the background worker when the registry's answer is stale or a newer version
 * waits to be installed, prompts in `ask` mode, and returns the line to print
 * after the command at a terminal. Agents, scripts and the MCP server get the
 * background update and nothing on their streams. Never waits for the
 * network, never fails the command.
 */
async function updateBeforeCommand(config: CliConfig, env: Env, io: Io, commandName: string): Promise<string | null> {
  if (updateChecksDisabled(env)) return null;
  try {
    const cachePath = updateCachePath(env);
    const cache = await readUpdateCache(cachePath);
    const now = Date.now();
    const { spawn, plan } = planUpdate({ cache, current: CLI_VERSION, autoUpdate: config.autoUpdate ?? DEFAULT_AUTO_UPDATE, target: detectInstall(), now });
    if (spawn && !updateLockHeld(updateLockPath(env), now)) spawnBackgroundUpdate(env);
    if (plan.action === "none" || commandName === "mcp" || !io.isTTY || io.json || io.quiet) return null;
    if (plan.action === "announce") {
      await markAnnounced(cachePath);
      return paint(io, "dim", `car-image updated itself: ${plan.from} → ${plan.version}.`);
    }
    if (cache) await markNoticeShown(cachePath, cache, now);
    if (plan.action === "notice") return paint(io, "yellow", plan.message);
    if (!io.stdinTTY) return paint(io, "yellow", `Update available: car-image ${CLI_VERSION} → ${plan.latest}. Run \`car-image update\`.`);
    const yes = await confirm(io, `Update car-image ${CLI_VERSION} → ${plan.latest} now? (car-image config set autoUpdate always|never)`, false);
    if (!yes) return null;
    const target = detectInstall({ version: plan.latest });
    io.stderr(`Running: ${target.display}\n`);
    const outcome = await runInstall(target, "inherit");
    return outcome.code === 0 ? paint(io, "dim", `Installed car-image ${plan.latest}; the next command runs it.`) : paint(io, "yellow", `The update failed (${outcome.error ?? "see above"}); run \`car-image update\`.`);
  } catch {
    return null;
  }
}

/** Entry point shared by the binary and tests. Resolves with the process exit code. */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const io = { ...createIo({}, env), ...deps.io };
    return renderError(error, io);
  }
  const io: Io = { ...createIo(args.flags, env), ...deps.io };

  if (args.flags.version === true) {
    io.stdout(`${CLI_VERSION}\n`);
    return 0;
  }

  const requested = args.command;
  let command: CommandDefinition | undefined = requested ? findCommand(requested) : undefined;
  if (args.flags.help === true) {
    // `<command> --help` shows that command whatever list it is on; bare `--help` shows the six main commands.
    if (command) io.stdout(helpText(helpEntries("all"), command.name));
    else if (args.flags.all === true) io.stdout(helpText(helpEntries("all")));
    else io.stdout(helpText(helpEntries("primary"), null, moreCommandNames()));
    return 0;
  }
  if (!requested) {
    if (io.isTTY && io.stdinTTY) command = findCommand("onboard");
    else {
      io.stdout(helpText(helpEntries("primary"), null, moreCommandNames()));
      return 0;
    }
  }
  if (!command) {
    io.stderr(`Unknown command "${requested}". Commands: ${COMMANDS.filter((entry) => entry.name !== "onboard").map((entry) => entry.name).join(", ")}\n`);
    return 2;
  }

  const cfgPath = resolveConfigPath(env);
  const config = await readConfig(cfgPath);
  if (command.name === "update" && args.flags.worker === true) {
    // The detached worker another command started: no telemetry, no output, one at a time.
    await runBackgroundUpdate({ cachePath: updateCachePath(env), lockPath: updateLockPath(env), logPath: updateLogPath(env), autoUpdate: config.autoUpdate ?? DEFAULT_AUTO_UPDATE, registry: registryUrl(env) });
    return 0;
  }
  const clientContext = createClientContext(args.flags, env, config, { fetch: deps.fetch });
  const telemetry = await setupTelemetry(config, cfgPath, env, io, command.name);
  const queued: TelemetryEvent[] = [...telemetry.events];

  const updateNotice = deps.skipUpdateCheck || command.name === "update" ? null : await updateBeforeCommand(config, env, io, command.name);

  const buildContext = (definition: CommandDefinition, parsed: ParsedArgs): CommandContext => ({
    args: parsed,
    io,
    env,
    config,
    configPath: cfgPath,
    clientContext: definition.name === "onboard" || definition.name === "whoami" ? createClientContext(parsed.flags, env, config, { fetch: deps.fetch }) : clientContext,
    telemetry: telemetry.state,
    emit: (event) => {
      queued.push(event);
    },
    runCommand: async (name, extra) => {
      const target = findCommand(name);
      if (!target) return 2;
      // Re-read config so a fresh login is visible to the next step.
      const latest = await readConfig(cfgPath);
      const nested = parseArgs(extra);
      const merged: ParsedArgs = { command: name, positionals: nested.positionals, flags: { ...args.flags, ...nested.flags } };
      const nestedContext: CommandContext = {
        ...buildContext(target, merged),
        config: latest,
        clientContext: createClientContext(merged.flags, env, latest, { fetch: deps.fetch }),
      };
      try {
        return await target.run(nestedContext);
      } catch (error) {
        return renderError(error, io, target.fixHint);
      }
    },
  });

  let code: number;
  try {
    code = await command.run(buildContext(command, args));
  } catch (error) {
    await rememberFailure(error, command.name, env);
    code = renderError(error, io, command.fixHint);
  }

  if (updateNotice) io.stderr(`${updateNotice}\n`);
  if (telemetry.state.enabled && telemetry.state.anonymousId && command.name !== "mcp") {
    queued.push(commandEvent(telemetry.state.anonymousId, command.name, code));
    void sendEvents(clientContext.client, queued);
  }
  return code;
}
