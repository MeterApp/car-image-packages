import { execFile } from "node:child_process";

/** One plugin install `car-image update` refreshed (or tried to). */
export interface PluginRefresh {
  host: "Claude Code" | "Codex";
  /** `<plugin>@<marketplace>` */
  id: string;
  ok: boolean;
  detail: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<RunResult>;

/** Runs a host's CLI without a shell (a `.cmd` shim needs one on Windows); a missing command is a non-zero code, never a throw. */
export const runHostCommand: CommandRunner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, shell: process.platform === "win32", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** Where Claude Code installed `plugin`, from `claude plugin list --json`. */
export function claudeInstalls(stdout: string, plugin: string): Array<{ id: string; marketplace: string; scope?: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown) => {
    const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const [name, marketplace] = id.split("@");
    if (name !== plugin || !marketplace) return [];
    return [{ id, marketplace, ...(typeof record.scope === "string" ? { scope: record.scope } : {}) }];
  });
}

/** The marketplaces `plugin` is installed from in Codex, read off `codex plugin list`'s table. */
export function codexMarketplaces(stdout: string, plugin: string): string[] {
  const marketplaces = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = /^(\S+)@(\S+)\s+installed\b/.exec(line.trim());
    if (match && match[1] === plugin && match[2]) marketplaces.add(match[2]);
  }
  return [...marketplaces];
}

function lastLine(text: string): string {
  return (
    text
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ""
  );
}

/** The `message` of the one-line JSON result Claude Code prints with `--json`. */
function jsonMessage(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as { message?: unknown };
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // not the result line
    }
  }
  return null;
}

/**
 * Brings the `plugin` installs of Claude Code and Codex up to date: refreshes
 * each marketplace that installed it, then the plugin (Claude Code), or the
 * marketplace snapshot (Codex). A host that is not installed, or does not have
 * the plugin, is skipped without a word.
 */
export async function refreshHostPlugins(plugin: string, run: CommandRunner = runHostCommand): Promise<PluginRefresh[]> {
  const results: PluginRefresh[] = [];

  const claude = await run("claude", ["plugin", "list", "--json"], 30_000);
  if (claude.code === 0) {
    const installs = claudeInstalls(claude.stdout, plugin);
    const failedMarketplaces = new Map<string, string>();
    for (const marketplace of new Set(installs.map((install) => install.marketplace))) {
      const refreshed = await run("claude", ["plugin", "marketplace", "update", marketplace, "--json"], 120_000);
      if (refreshed.code !== 0) failedMarketplaces.set(marketplace, jsonMessage(refreshed.stdout) ?? (lastLine(refreshed.stderr || refreshed.stdout) || `exit ${refreshed.code}`));
    }
    for (const install of installs) {
      const failed = failedMarketplaces.get(install.marketplace);
      if (failed) {
        results.push({ host: "Claude Code", id: install.id, ok: false, detail: `marketplace ${install.marketplace}: ${failed}` });
        continue;
      }
      const updated = await run("claude", ["plugin", "update", install.id, "--json", ...(install.scope ? ["--scope", install.scope] : [])], 120_000);
      const detail = jsonMessage(updated.stdout) ?? (lastLine(updated.code === 0 ? updated.stdout : updated.stderr || updated.stdout) || (updated.code === 0 ? "up to date" : `exit ${updated.code}`));
      results.push({ host: "Claude Code", id: install.id, ok: updated.code === 0, detail });
    }
  }

  const codex = await run("codex", ["plugin", "list"], 30_000);
  if (codex.code === 0) {
    for (const marketplace of codexMarketplaces(codex.stdout, plugin)) {
      const upgraded = await run("codex", ["plugin", "marketplace", "upgrade", marketplace], 120_000);
      const detail = lastLine(upgraded.code === 0 ? upgraded.stdout : upgraded.stderr || upgraded.stdout) || (upgraded.code === 0 ? "marketplace refreshed" : `exit ${upgraded.code}`);
      results.push({ host: "Codex", id: `${plugin}@${marketplace}`, ok: upgraded.code === 0, detail });
    }
  }
  return results;
}
