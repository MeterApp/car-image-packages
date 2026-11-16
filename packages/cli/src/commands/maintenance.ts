import { DEFAULT_BASE_URL } from "@meterapp/car-image-sdk";
import { AUTO_UPDATE_MODES, CONFIG_KEYS, DEFAULT_AUTO_UPDATE, readConfig, storedBaseUrl, updateCachePath, updateConfig, type AutoUpdateMode, type CliConfig } from "../config.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { refreshHostPlugins } from "../host-plugins.js";
import { keyValues, ok, printJson, warn } from "../output.js";
import { TELEMETRY_DISCLOSURE, telemetryEnabled } from "../telemetry.js";
import { checkForUpdate, detectInstall, isNewer, recordInstall, registryUrl, runInstall } from "../update.js";
import { CLI_VERSION, PACKAGE_NAME } from "../version.js";

export const updateCommand: CommandDefinition = {
  name: "update",
  summary: "Update the CLI now, and the car-image plugin in Claude Code and Codex (new CLI versions also install themselves in the background); --check only reports",
  usage: "car-image update [--check] [--no-plugins] [--json]",
  async run(ctx: CommandContext): Promise<number> {
    const { io } = ctx;
    const cachePath = updateCachePath(ctx.env);
    const { latest, fromCache } = await checkForUpdate({ cachePath, force: true, timeoutMs: 8000, registry: registryUrl(ctx.env) });
    const newer = isNewer(latest, CLI_VERSION);
    const target = detectInstall({ version: newer ? latest : "latest" });
    const autoUpdate = ctx.config.autoUpdate ?? DEFAULT_AUTO_UPDATE;
    const report = {
      current: CLI_VERSION,
      latest,
      update_available: newer,
      registry_reached: !fromCache,
      auto_update: autoUpdate,
      install: { method: target.method, command: target.display, blocked: target.blocked ?? null },
    };

    if (ctx.args.flags.check === true) {
      if (io.json) {
        printJson(io, report);
        return 0;
      }
      if (fromCache) io.stdout(`${warn(io, `Could not reach the npm registry; running ${CLI_VERSION}${latest ? ` (last known latest: ${latest})` : ""}.`)}\n`);
      else if (newer) io.stdout(`Update available: ${CLI_VERSION} → ${latest}. Run: ${target.method === "npx" ? `npx ${PACKAGE_NAME}@latest` : "car-image update"}\n`);
      else io.stdout(`${ok(io, `car-image ${CLI_VERSION} is up to date.`)}\n`);
      return 0;
    }

    let cli: string;
    if (fromCache) {
      cli = `Could not reach the npm registry; car-image stays at ${CLI_VERSION}.`;
      if (!io.json) io.stdout(`${warn(io, cli)}\n`);
    } else if (!newer) {
      cli = `car-image ${CLI_VERSION} is up to date.`;
      if (!io.json) io.stdout(`${ok(io, cli)}\n`);
    } else if (target.method === "npx") {
      cli = `You are running through npx; the next \`npx ${PACKAGE_NAME}@latest\` call uses ${latest}.`;
      if (!io.json) io.stdout(`${cli}\n`);
    } else if (!target.command) {
      cli = `car-image ${latest} is available; this copy updates with: ${target.display}.`;
      if (!io.json) io.stdout(`${cli}\n`);
    } else {
      if (target.blocked) {
        throw new CliError(`Cannot update car-image here: ${target.blocked}.`, 1, `Run ${target.display} as a user who can write there, or move npm's global prefix to a directory you own (npm config set prefix ~/.npm-global).`);
      }
      io.stderr(`Updating car-image ${CLI_VERSION} → ${latest} (${target.display})…\n`);
      // The package manager's output goes to stderr, so --json stays one document on stdout.
      const outcome = await runInstall(target, 2);
      await recordInstall(cachePath, { version: latest, from: CLI_VERSION, at: Date.now(), ok: outcome.code === 0, ...(outcome.error ? { error: outcome.error } : {}) });
      if (outcome.code !== 0) {
        throw new CliError(`Update failed (${outcome.error ?? `exit ${outcome.code}`}).`, 1, `Run manually: ${target.display} (add sudo only if your global prefix requires it, or switch to a user-writable prefix).`);
      }
      cli = `Updated car-image to ${latest}.`;
      if (!io.json) io.stdout(`${ok(io, cli)}\n`);
    }

    const plugins = ctx.args.flags.plugins === false ? [] : await refreshHostPlugins("car-image");
    if (io.json) {
      printJson(io, { ...report, cli, plugins });
      return plugins.some((entry) => !entry.ok) ? 1 : 0;
    }
    for (const entry of plugins) {
      const line = `${entry.host}: ${entry.id} — ${entry.detail}`;
      io.stdout(`${entry.ok ? ok(io, line) : warn(io, line)}\n`);
    }
    if (plugins.some((entry) => entry.host === "Claude Code" && entry.ok)) {
      io.stdout("Restart Claude Code (or run /reload-plugins) to load the plugin. To have Claude Code keep it current: /plugin → Marketplaces → choose the marketplace → Enable auto-update.\n");
    }
    return plugins.some((entry) => !entry.ok) ? 1 : 0;
  },
};

function parseConfigValue(key: (typeof CONFIG_KEYS)[number], raw: string): Partial<CliConfig> {
  switch (key) {
    case "autoUpdate": {
      const value = raw.trim().toLowerCase();
      if (!(AUTO_UPDATE_MODES as readonly string[]).includes(value)) throw new CliError(`autoUpdate must be one of: ${AUTO_UPDATE_MODES.join(", ")}`, 2);
      return { autoUpdate: value as AutoUpdateMode };
    }
    case "telemetry": {
      const value = raw.trim().toLowerCase();
      if (["on", "true", "1", "yes"].includes(value)) return { telemetry: true };
      if (["off", "false", "0", "no"].includes(value)) return { telemetry: false };
      throw new CliError("telemetry must be on or off", 2);
    }
    case "baseUrl": {
      let baseUrl: string;
      try {
        const url = new URL(raw.trim());
        if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
        baseUrl = url.origin + url.pathname.replace(/\/+$/, "");
      } catch {
        throw new CliError("baseUrl must be an http(s) URL", 2);
      }
      return { baseUrl: storedBaseUrl(baseUrl) };
    }
    default:
      throw new CliError(`Unknown config key ${String(key)}`, 2);
  }
}

export const configCommand: CommandDefinition = {
  name: "config",
  summary: "Read or change settings: autoUpdate (always|ask|never), telemetry (on|off), baseUrl; `config path`",
  usage: "car-image config path\ncar-image config get <autoUpdate|telemetry|baseUrl>\ncar-image config set <autoUpdate|telemetry|baseUrl> <value>\ncar-image config list",
  async run(ctx: CommandContext): Promise<number> {
    const [action, rawKey, value] = ctx.args.positionals;
    const { io } = ctx;
    if (!action || action === "list") {
      const config = await readConfig(ctx.configPath);
      const view = {
        path: ctx.configPath,
        autoUpdate: config.autoUpdate ?? DEFAULT_AUTO_UPDATE,
        telemetry: telemetryEnabled(config, ctx.env) ? "on" : "off",
        baseUrl: config.baseUrl ?? "(default)",
        apiKey: config.apiKey ? "(stored)" : "(none)",
      };
      if (io.json) printJson(io, view);
      else io.stdout(`${keyValues(io, Object.entries(view))}\n`);
      return 0;
    }
    if (action === "path") {
      io.stdout(`${ctx.configPath}\n`);
      return 0;
    }
    if (!rawKey || !(CONFIG_KEYS as readonly string[]).includes(rawKey)) {
      throw new CliError(`Usage: car-image config ${action} <${CONFIG_KEYS.join("|")}>`, 2);
    }
    const key = rawKey as (typeof CONFIG_KEYS)[number];
    if (action === "get") {
      const config = await readConfig(ctx.configPath);
      const current = key === "telemetry" ? (telemetryEnabled(config, ctx.env) ? "on" : "off") : key === "autoUpdate" ? (config.autoUpdate ?? DEFAULT_AUTO_UPDATE) : (config.baseUrl ?? "");
      if (io.json) printJson(io, { [key]: current });
      else io.stdout(`${current}\n`);
      return 0;
    }
    if (action === "set") {
      if (value === undefined) throw new CliError(`Usage: car-image config set ${key} <value>`, 2);
      const patch = parseConfigValue(key, value);
      await updateConfig(patch, ctx.configPath);
      const cleared = key === "baseUrl" && patch.baseUrl === undefined;
      if (io.json) printJson(io, cleared ? { ok: true, baseUrl: null, default: DEFAULT_BASE_URL } : { ok: true, ...patch });
      else io.stdout(`${ok(io, cleared ? `baseUrl = (default) ${DEFAULT_BASE_URL}` : `${key} = ${String(Object.values(patch)[0])}`)}\n`);
      return 0;
    }
    throw new CliError(`Unknown config action "${action}"`, 2, "Use: path, get, set, list");
  },
};

export const telemetryCommand: CommandDefinition = {
  name: "telemetry",
  summary: "Turn anonymous usage events on or off, or show the current state",
  usage: "car-image telemetry on|off|status",
  async run(ctx: CommandContext): Promise<number> {
    const action = (ctx.args.positionals[0] ?? "status").toLowerCase();
    const { io } = ctx;
    if (action === "on" || action === "off") {
      const config = await updateConfig({ telemetry: action === "on" }, ctx.configPath);
      const effective = telemetryEnabled(config, ctx.env);
      if (io.json) printJson(io, { telemetry: action === "on", effective });
      else io.stdout(`${ok(io, `Telemetry ${action}.`)}${action === "on" && !effective ? " (CAR_IMAGE_TELEMETRY in the environment still disables it)" : ""}\n`);
      return 0;
    }
    if (action !== "status") throw new CliError("Usage: car-image telemetry on|off|status", 2);
    const config = await readConfig(ctx.configPath);
    const enabled = telemetryEnabled(config, ctx.env);
    if (io.json) {
      printJson(io, { enabled, anonymous_id: config.anonymousId ?? null, env_override: ctx.env.CAR_IMAGE_TELEMETRY ?? null });
      return 0;
    }
    io.stdout(`Telemetry is ${enabled ? "on" : "off"}${ctx.env.CAR_IMAGE_TELEMETRY !== undefined ? ` (CAR_IMAGE_TELEMETRY=${ctx.env.CAR_IMAGE_TELEMETRY})` : ""}.\n${TELEMETRY_DISCLOSURE}\n`);
    return 0;
  },
};
