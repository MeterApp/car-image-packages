import { CarImageError, type DeviceCodeResponse, type DeviceTokenResult } from "@meterapp/car-image-sdk";
import { describe, expect, it, vi } from "vitest";
import { runDeviceLogin } from "./device-login.js";
import { CliError } from "./errors.js";

const info: DeviceCodeResponse = {
  device_code: "dev_123",
  user_code: "ABCD-EFGH",
  verification_uri: "https://api.test/device",
  verification_uri_complete: "https://api.test/device?code=ABCD-EFGH",
  expires_in: 600,
  interval: 3,
};

function harness(results: Array<DeviceTokenResult | Error>, expiresIn = 600) {
  let clock = 0;
  const sleeps: number[] = [];
  const onCode = vi.fn();
  const poll = vi.fn(async () => {
    const next = results.shift();
    if (!next) throw new Error("unexpected poll");
    if (next instanceof Error) throw next;
    return next;
  });
  const deps = {
    start: async () => ({ ...info, expires_in: expiresIn }),
    poll,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    onCode,
  };
  return { deps, sleeps, onCode, poll };
}

describe("runDeviceLogin", () => {
  it("shows the code, polls at the server interval and returns the key", async () => {
    const { deps, sleeps, onCode, poll } = harness([{ status: "pending" }, { status: "pending" }, { status: "approved", accessToken: "cimg_new", tokenType: "Bearer", scope: "images:read" }]);
    const result = await runDeviceLogin(deps);
    expect(onCode).toHaveBeenCalledWith(expect.objectContaining({ user_code: "ABCD-EFGH" }));
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poll).toHaveBeenCalledWith("dev_123");
    expect(sleeps).toEqual([3000, 3000, 3000]);
    expect(result).toEqual({ accessToken: "cimg_new", scope: "images:read", polls: 3 });
  });

  it("fails clearly when the code expires", async () => {
    const { deps } = harness([{ status: "pending" }, { status: "expired" }]);
    await expect(runDeviceLogin(deps)).rejects.toThrowError(CliError);
    await expect(runDeviceLogin(harness([{ status: "expired" }]).deps)).rejects.toThrowError(/expired/);
  });

  it("backs off on transient errors but surfaces permanent ones", async () => {
    const transient = new CarImageError({ status: 503, title: "Unavailable", detail: "try later" });
    const { deps, sleeps } = harness([transient, transient, { status: "approved", accessToken: "cimg_ok", tokenType: "Bearer", scope: "" }]);
    const result = await runDeviceLogin(deps);
    expect(result.accessToken).toBe("cimg_ok");
    expect(sleeps).toEqual([3000, 6000, 12000]);

    const permanent = new CarImageError({ status: 400, title: "Bad request", detail: "invalid_grant" });
    await expect(runDeviceLogin(harness([permanent]).deps)).rejects.toMatchObject({ status: 400 });
  });

  it("times out at the deadline", async () => {
    const pending = Array.from({ length: 20 }, () => ({ status: "pending" }) as DeviceTokenResult);
    const { deps, poll } = harness(pending, 30);
    await expect(runDeviceLogin(deps)).rejects.toThrowError(/Timed out/);
    expect(poll.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
