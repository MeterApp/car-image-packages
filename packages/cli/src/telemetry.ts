import { randomUUID } from "node:crypto";
import { platform, release } from "node:os";
import type { CarImageClient, TelemetryEvent } from "@meterapp/car-image-sdk";
import type { CliConfig, Env } from "./config.js";
import { CLI_VERSION } from "./version.js";

export const TELEMETRY_TIMEOUT_MS = 1500;

export const TELEMETRY_DISCLOSURE =
  "car-image sends anonymous usage events (command name, version, OS, Node version, exit code; never keys, vehicles or file names). Disable with `car-image telemetry off` or CAR_IMAGE_TELEMETRY=0.";

/** `CAR_IMAGE_TELEMETRY=0` (or `false`/`off`) wins; otherwise the config flag; default on. */
export function telemetryEnabled(config: Pick<CliConfig, "telemetry">, env: Env = process.env): boolean {
  const raw = env.CAR_IMAGE_TELEMETRY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  if (env.DO_NOT_TRACK === "1") return false;
  return config.telemetry !== false;
}

export function newAnonymousId(): string {
  return randomUUID();
}

export function baseProperties(): Record<string, unknown> {
  return {
    version: CLI_VERSION,
    os: `${platform()} ${release()}`.trim(),
    node: process.version,
  };
}

export function commandEvent(anonymousId: string, command: string, exitCode: number, extra: Record<string, unknown> = {}): TelemetryEvent {
  return {
    event: "cli_command",
    anonymous_id: anonymousId,
    source: "cli",
    properties: { ...baseProperties(), command, exit_code: exitCode, ...extra },
  };
}

export function simpleEvent(anonymousId: string, event: "cli_install" | "cli_login" | "cli_doctor", extra: Record<string, unknown> = {}): TelemetryEvent {
  return { event, anonymous_id: anonymousId, source: "cli", properties: { ...baseProperties(), ...extra } };
}

/**
 * Fire-and-forget: never throws, never blocks the command for more than
 * `TELEMETRY_TIMEOUT_MS` (the abort also releases the socket so the process
 * can exit).
 */
export function sendEvents(client: Pick<CarImageClient, "trackEvents">, events: TelemetryEvent[], timeoutMs = TELEMETRY_TIMEOUT_MS): Promise<void> {
  if (events.length === 0) return Promise.resolve();
  return client
    .trackEvents(events, { retries: 0, timeoutMs })
    .then(
      () => undefined,
      () => undefined
    );
}
