import { isCarImageError, type DeviceCodeResponse, type DeviceTokenResult } from "@meterapp/car-image-sdk";
import { CliError } from "./errors.js";

export interface DeviceLoginDeps {
  start(): Promise<DeviceCodeResponse>;
  poll(deviceCode: string): Promise<DeviceTokenResult>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Show the code and URL to the human (and open the browser). */
  onCode(info: DeviceCodeResponse): void | Promise<void>;
  /** Progress hook while waiting. */
  onPending?(elapsedMs: number): void;
}

export interface DeviceLoginResult {
  accessToken: string;
  scope: string;
  polls: number;
}

export const MAX_POLL_INTERVAL_MS = 15_000;

/**
 * OAuth-style device flow: start, show the code, poll until approved. Transient
 * failures (network, 5xx, 429) back off and keep polling; the flow gives up
 * when the server says the code expired or the deadline passes.
 */
export async function runDeviceLogin(deps: DeviceLoginDeps): Promise<DeviceLoginResult> {
  const info = await deps.start();
  await deps.onCode(info);

  const startedAt = deps.now();
  const deadline = startedAt + Math.max(30, info.expires_in || 600) * 1000;
  let intervalMs = Math.max(1, info.interval || 3) * 1000;
  let polls = 0;

  while (deps.now() < deadline) {
    await deps.sleep(intervalMs);
    polls += 1;
    let result: DeviceTokenResult;
    try {
      result = await deps.poll(info.device_code);
    } catch (error) {
      const transient = isCarImageError(error) && (error.status === 0 || error.status === 429 || error.status >= 500);
      if (!transient) throw error;
      intervalMs = Math.min(intervalMs * 2, MAX_POLL_INTERVAL_MS);
      continue;
    }
    if (result.status === "approved") {
      if (!result.accessToken) throw new CliError("The server approved the login but returned no key.", 1, "Try `car-image login` again.");
      return { accessToken: result.accessToken, scope: result.scope, polls };
    }
    if (result.status === "expired") {
      throw new CliError("The login code expired before it was approved.", 1, "Run `car-image login` again and approve the code within 10 minutes.");
    }
    deps.onPending?.(deps.now() - startedAt);
  }
  throw new CliError("Timed out waiting for browser approval.", 1, "Run `car-image login` again.");
}
