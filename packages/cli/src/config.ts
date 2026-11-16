import { DEFAULT_BASE_URL } from "@meterapp/car-image-sdk";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** `always` (the default): install new versions in the background; `ask`: a y/N prompt at a terminal; `never`: only say so. */
export type AutoUpdateMode = "ask" | "always" | "never";
export const AUTO_UPDATE_MODES: readonly AutoUpdateMode[] = ["ask", "always", "never"];
export const DEFAULT_AUTO_UPDATE: AutoUpdateMode = "always";

export interface CliConfig {
  /** Stored with file mode 0600; never printed after login. */
  apiKey?: string;
  baseUrl?: string;
  autoUpdate?: AutoUpdateMode;
  /** Anonymous usage events; default on, `CAR_IMAGE_TELEMETRY=0` overrides. */
  telemetry?: boolean;
  anonymousId?: string;
  telemetryDisclosed?: boolean;
}

export const CONFIG_KEYS = ["autoUpdate", "telemetry", "baseUrl"] as const;

/**
 * Hosts that serve the API only as an alias of https://carimage.dev.
 * `car-image login` saves the base URL it signed in against, and until the
 * move to carimage.dev on 2026-09-03 that was `https://car-imgs.vercel.app`,
 * so a config written then pinned every later command to the alias. The CLI
 * reads a base URL on one of these hosts as the default.
 */
export const LEGACY_API_HOSTS: readonly string[] = ["car-imgs.vercel.app"];

/** True for a base URL on a host that only aliases the public origin. */
export function isLegacyBaseUrl(value: string): boolean {
  try {
    return LEGACY_API_HOSTS.includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * The base URL to write down: nothing for the default or a legacy alias, so
 * the config follows the CLI's default wherever it moves, else the URL (a
 * local or staging server, where the stored key was minted).
 */
export function storedBaseUrl(baseUrl: string): string | undefined {
  return baseUrl === DEFAULT_BASE_URL || isLegacyBaseUrl(baseUrl) ? undefined : baseUrl;
}
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export type Env = Record<string, string | undefined>;

/** `$CAR_IMAGE_CONFIG`, else `$XDG_CONFIG_HOME/car-image-api/config.json`, else `~/.config/...`. */
export function configPath(env: Env = process.env): string {
  const explicit = env.CAR_IMAGE_CONFIG?.trim();
  if (explicit) return explicit;
  const root = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config");
  return join(root, "car-image-api", "config.json");
}

/** The last API call this CLI saw fail, for `car-image feedback report --last`; next to the config file. */
export function lastErrorPath(env: Env = process.env): string {
  return join(dirname(configPath(env)), "last-error.json");
}

/** Update-check cache, next to the config file. */
export function updateCachePath(env: Env = process.env): string {
  return join(dirname(configPath(env)), "update-check.json");
}

/** Held by the one background update worker allowed at a time. */
export function updateLockPath(env: Env = process.env): string {
  return join(dirname(configPath(env)), "update.lock");
}

/** The package manager's output from the last automatic update. */
export function updateLogPath(env: Env = process.env): string {
  return join(dirname(configPath(env)), "update.log");
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Atomic write (temp file + rename) with a private mode; parent directory is 0700. */
export async function writeJsonFile(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await chmod(temp, mode);
  await rename(temp, path);
  await chmod(path, mode);
}

export async function readConfig(path: string = configPath()): Promise<CliConfig> {
  const raw = await readJsonFile<Record<string, unknown>>(path);
  if (!raw) return {};
  const config: CliConfig = {};
  if (typeof raw.apiKey === "string" && raw.apiKey) config.apiKey = raw.apiKey;
  if (typeof raw.baseUrl === "string" && raw.baseUrl && !isLegacyBaseUrl(raw.baseUrl)) config.baseUrl = raw.baseUrl;
  if (raw.autoUpdate === "ask" || raw.autoUpdate === "always" || raw.autoUpdate === "never") config.autoUpdate = raw.autoUpdate;
  if (typeof raw.telemetry === "boolean") config.telemetry = raw.telemetry;
  if (typeof raw.anonymousId === "string" && raw.anonymousId) config.anonymousId = raw.anonymousId;
  if (typeof raw.telemetryDisclosed === "boolean") config.telemetryDisclosed = raw.telemetryDisclosed;
  return config;
}

export async function writeConfig(config: CliConfig, path: string = configPath()): Promise<void> {
  const clean: CliConfig = {};
  for (const [key, value] of Object.entries(config) as Array<[keyof CliConfig, unknown]>) {
    if (value !== undefined && value !== null && value !== "") (clean as Record<string, unknown>)[key] = value;
  }
  await writeJsonFile(path, clean, 0o600);
}

export async function updateConfig(patch: Partial<CliConfig>, path: string = configPath()): Promise<CliConfig> {
  const current = await readConfig(path);
  const next: CliConfig = { ...current };
  for (const [key, value] of Object.entries(patch) as Array<[keyof CliConfig, unknown]>) {
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  await writeConfig(next, path);
  return next;
}

/** Display form such as `cimg_A1b2…9zY`; the full key is never printed after login. */
export function maskKey(key: string | undefined): string {
  if (!key) return "(none)";
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 9)}…${key.slice(-3)}`;
}
