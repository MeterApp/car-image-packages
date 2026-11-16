import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireUpdateLock,
  checkForUpdate,
  compareVersions,
  detectInstall,
  INSTALL_RETRY_MS,
  isNewer,
  LOCK_STALE_MS,
  NOTICE_INTERVAL_MS,
  planUpdate,
  readUpdateCache,
  releaseUpdateLock,
  runBackgroundUpdate,
  UPDATE_CHECK_TTL_MS,
  updateChecksDisabled,
  type InstallTarget,
  type PlanUpdateInput,
  type UpdateCache,
} from "./update.js";
import { CLI_VERSION } from "./version.js";

describe("compareVersions", () => {
  it("orders semver including prereleases", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(-1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("garbage", "1.0.0")).toBe(0);
    expect(isNewer("1.0.1", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer(null, "1.0.0")).toBe(false);
  });
});

describe("updateChecksDisabled", () => {
  it("is off in CI and when NO_UPDATE_NOTIFIER or CAR_IMAGE_NO_UPDATE_CHECK says so", () => {
    expect(updateChecksDisabled({})).toBe(false);
    expect(updateChecksDisabled({ CI: "true" })).toBe(true);
    expect(updateChecksDisabled({ CI: "0" })).toBe(false);
    expect(updateChecksDisabled({ NO_UPDATE_NOTIFIER: "1" })).toBe(true);
    expect(updateChecksDisabled({ CAR_IMAGE_NO_UPDATE_CHECK: "1" })).toBe(true);
    expect(updateChecksDisabled({ CAR_IMAGE_NO_UPDATE_CHECK: "false" })).toBe(false);
  });
});

describe("detectInstall", () => {
  const all = () => true;

  it("updates a global npm install in its own prefix, with the npm beside the running Node", () => {
    const target = detectInstall({
      modulePath: "/opt/homebrew/lib/node_modules/@meterapp/car-image/dist/update.js",
      version: "2.0.0",
      platform: "darwin",
      execPath: "/opt/homebrew/bin/node",
      exists: all,
      writable: all,
    });
    expect(target).toEqual({
      method: "npm",
      command: "/opt/homebrew/bin/node",
      args: ["/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js", "install", "--global", "--prefix", "/opt/homebrew", "@meterapp/car-image@2.0.0"],
      display: "npm install -g @meterapp/car-image@2.0.0",
    });
  });

  it("falls back to npm on PATH, and says when the prefix is not writable", () => {
    const exists = (path: string) => !path.endsWith("npm-cli.js");
    const target = detectInstall({ modulePath: "/usr/lib/node_modules/@meterapp/car-image/dist/update.js", version: "2.0.0", platform: "linux", execPath: "/usr/bin/node", exists, writable: () => false });
    expect(target).toMatchObject({ method: "npm", command: "npm", args: ["install", "--global", "--prefix", "/usr", "@meterapp/car-image@2.0.0"], blocked: "/usr/lib/node_modules is not writable by this user" });
  });

  it("reads the Windows layout, where the prefix holds node_modules and the .cmd shim", () => {
    const target = detectInstall({
      modulePath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@meterapp\\car-image\\dist\\update.js",
      version: "2.0.0",
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === "C:/Users/me/AppData/Roaming/npm/car-image.cmd",
      writable: all,
    });
    expect(target).toMatchObject({ method: "npm", command: "npm", args: ["install", "--global", "--prefix", "C:/Users/me/AppData/Roaming/npm", "@meterapp/car-image@2.0.0"] });
  });

  it("uses the package manager that owns the global install", () => {
    const at = (modulePath: string) => detectInstall({ modulePath, version: "2.0.0", exists: all, writable: all });
    expect(at("/Users/me/Library/pnpm/global/5/node_modules/.pnpm/@meterapp+car-image@1.0.0/node_modules/@meterapp/car-image/dist/update.js")).toMatchObject({ method: "pnpm", command: "pnpm", args: ["add", "--global", "@meterapp/car-image@2.0.0"] });
    expect(at("/Users/me/.bun/install/global/node_modules/@meterapp/car-image/dist/update.js")).toMatchObject({ method: "bun", command: "bun", args: ["add", "--global", "@meterapp/car-image@2.0.0"] });
    expect(at("/Users/me/.config/yarn/global/node_modules/@meterapp/car-image/dist/update.js")).toMatchObject({ method: "yarn", command: "yarn", args: ["global", "add", "@meterapp/car-image@2.0.0"] });
    expect(at("/Users/me/.volta/tools/image/packages/@meterapp/car-image/lib/node_modules/@meterapp/car-image/dist/update.js")).toMatchObject({ method: "volta", command: "volta", args: ["install", "@meterapp/car-image@2.0.0"] });
  });

  it("never installs over an npx cache, a project dependency or a source build", () => {
    const at = (modulePath: string) => detectInstall({ modulePath, exists: all, writable: all });
    expect(at("/Users/me/.npm/_npx/abc123/node_modules/@meterapp/car-image/dist/update.js")).toEqual({ method: "npx", display: "npx @meterapp/car-image@latest" });
    expect(at("/Users/me/.cache/pnpm/dlx-1234/node_modules/@meterapp/car-image/dist/update.js").method).toBe("npx");
    expect(detectInstall({ modulePath: "/Users/me/app/node_modules/@meterapp/car-image/dist/update.js", exists: () => false, writable: all })).toMatchObject({ method: "project" });
    expect(at("/Users/me/car-image-server/packages/cli/dist/update.js")).toMatchObject({ method: "source" });
    expect(at("/Users/me/app/node_modules/@meterapp/car-image/dist/update.js").command).not.toBeDefined();
  });
});

describe("planUpdate", () => {
  const now = 1_800_000_000_000;
  const npm: InstallTarget = { method: "npm", command: "npm", args: [], display: "npm install -g @meterapp/car-image@latest" };
  const fresh = (extra: Partial<UpdateCache> = {}): UpdateCache => ({ checkedAt: now - 60_000, latest: "1.1.0", ...extra });
  const base: PlanUpdateInput = { cache: fresh(), current: "1.0.0", autoUpdate: "always", target: npm, now };

  it("starts the worker when the answer is stale, and only then when nothing is pending", () => {
    expect(planUpdate({ ...base, cache: null }).spawn).toBe(true);
    expect(planUpdate({ ...base, cache: fresh({ checkedAt: now - UPDATE_CHECK_TTL_MS, latest: "1.0.0" }) }).spawn).toBe(true);
    expect(planUpdate({ ...base, cache: fresh({ latest: "1.0.0" }) })).toEqual({ spawn: false, plan: { action: "none" } });
  });

  it("installs a known newer version in the background without a word", () => {
    expect(planUpdate(base)).toEqual({ spawn: true, plan: { action: "none" } });
    // Once a worker has tried this version, it is not started again for it until the retry interval.
    const tried = fresh({ install: { version: "1.1.0", from: "1.0.0", at: now - 60_000, ok: true } });
    expect(planUpdate({ ...base, cache: tried })).toEqual({ spawn: false, plan: { action: "none" } });
    const longAgo = fresh({ install: { version: "1.1.0", from: "1.0.0", at: now - INSTALL_RETRY_MS, ok: false } });
    expect(planUpdate({ ...base, cache: longAgo }).spawn).toBe(true);
  });

  it("announces a finished background update once", () => {
    const done = fresh({ install: { version: "1.1.0", from: "1.0.0", at: now - 60_000, ok: true } });
    expect(planUpdate({ ...base, cache: done, current: "1.1.0" }).plan).toEqual({ action: "announce", from: "1.0.0", version: "1.1.0" });
    expect(planUpdate({ ...base, cache: { ...done, install: { ...done.install!, announced: true } }, current: "1.1.0" }).plan).toEqual({ action: "none" });
  });

  it("tells a person what it cannot do itself, at most once a day", () => {
    const failed = fresh({ install: { version: "1.1.0", from: "1.0.0", at: now - 60_000, ok: false, error: "npm exited with 1" } });
    expect(planUpdate({ ...base, cache: failed }).plan).toMatchObject({ action: "notice", message: expect.stringContaining("The automatic update failed (npm exited with 1)") });
    expect(planUpdate({ ...base, autoUpdate: "never" }).plan).toMatchObject({ action: "notice", message: expect.stringContaining("automatic updates are off") });
    expect(planUpdate({ ...base, autoUpdate: "never" }).spawn).toBe(false);
    expect(planUpdate({ ...base, autoUpdate: "ask" }).plan).toEqual({ action: "ask", latest: "1.1.0" });
    expect(planUpdate({ ...base, target: { method: "npx", display: "npx @meterapp/car-image@latest" } }).plan).toMatchObject({ action: "notice", message: expect.stringContaining("`npx @meterapp/car-image@latest` runs it") });
    expect(planUpdate({ ...base, target: { ...npm, blocked: "/usr/lib/node_modules is not writable by this user" } }).plan).toMatchObject({ action: "notice", message: expect.stringContaining("cannot install itself") });
    expect(planUpdate({ ...base, target: { method: "project", display: "npm install @meterapp/car-image@latest in the project that depends on it" } }).plan).toMatchObject({ action: "notice" });
    expect(planUpdate({ ...base, target: { method: "source", display: "rebuild it from source" } }).plan).toEqual({ action: "none" });
    expect(planUpdate({ ...base, autoUpdate: "never", cache: fresh({ lastNoticeAt: now - 60_000 }) }).plan).toEqual({ action: "none" });
    expect(planUpdate({ ...base, autoUpdate: "never", cache: fresh({ lastNoticeAt: now - NOTICE_INTERVAL_MS }) }).plan.action).toBe("notice");
  });
});

describe("checkForUpdate and the background worker", () => {
  let dir: string;
  let paths: { cachePath: string; lockPath: string; logPath: string };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "car-image-update-"));
    paths = { cachePath: join(dir, "update-check.json"), lockPath: join(dir, "update.lock"), logPath: join(dir, "update.log") };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uses the cache within the interval and refreshes when stale or forced", async () => {
    const now = 1_700_000_000_000;
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) }));

    const first = await checkForUpdate({ cachePath: paths.cachePath, now, fetchImpl });
    expect(first).toMatchObject({ latest: "9.9.9", fromCache: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await checkForUpdate({ cachePath: paths.cachePath, now: now + 60_000, fetchImpl });
    expect(second).toMatchObject({ latest: "9.9.9", fromCache: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const third = await checkForUpdate({ cachePath: paths.cachePath, now: now + UPDATE_CHECK_TTL_MS, fetchImpl });
    expect(third.fromCache).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await checkForUpdate({ cachePath: paths.cachePath, now: now + UPDATE_CHECK_TTL_MS, fetchImpl, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps the last answer, the notice time and the install record when the registry fails", async () => {
    await writeFile(paths.cachePath, JSON.stringify({ checkedAt: 0, latest: "1.0.0", lastNoticeAt: 42, install: { version: "1.0.0", from: "0.9.0", at: 1, ok: true } }));
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await checkForUpdate({ cachePath: paths.cachePath, now: 10_000_000_000, fetchImpl: failing });
    expect(result).toMatchObject({ latest: "1.0.0", fromCache: true });
    expect(result.cache).toMatchObject({ checkedAt: 10_000_000_000, lastNoticeAt: 42, install: { version: "1.0.0", ok: true } });
  });

  const newer = "99.0.0";
  const registry = vi.fn(async () => ({ ok: true, json: async () => ({ version: newer }) }));
  const target: InstallTarget = { method: "npm", command: "npm", args: ["install"], display: "npm install -g @meterapp/car-image@99.0.0" };

  it("installs a newer version in always mode and records it", async () => {
    const install = vi.fn(async () => ({ code: 0 }));
    const cache = await runBackgroundUpdate({ ...paths, autoUpdate: "always", now: 5_000, fetchImpl: registry, target, install });
    expect(install).toHaveBeenCalledWith(target, paths.logPath);
    expect(cache?.install).toEqual({ version: newer, from: CLI_VERSION, at: 5_000, ok: true });
    expect(await readUpdateCache(paths.cachePath)).toMatchObject({ latest: newer, install: { version: newer, ok: true } });
    // The lock is released for the next worker.
    expect(acquireUpdateLock(paths.lockPath)).toBe(true);
  });

  it("records a failure and does not try that version again until the retry interval", async () => {
    const install = vi.fn(async () => ({ code: 1, error: "npm install -g @meterapp/car-image@99.0.0 exited with 1" }));
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", now: 5_000, fetchImpl: registry, target, install });
    expect((await readUpdateCache(paths.cachePath))?.install).toMatchObject({ ok: false, error: expect.stringContaining("exited with 1") });
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", now: 5_000 + INSTALL_RETRY_MS - 1, fetchImpl: registry, target, install });
    expect(install).toHaveBeenCalledTimes(1);
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", now: 5_000 + INSTALL_RETRY_MS, fetchImpl: registry, target, install });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("only checks in ask or never mode, offline, for a copy it cannot replace, or while another worker runs", async () => {
    const install = vi.fn(async () => ({ code: 0 }));
    for (const autoUpdate of ["ask", "never"] as const) {
      expect(await runBackgroundUpdate({ ...paths, autoUpdate, fetchImpl: registry, target, install })).toMatchObject({ latest: newer });
    }
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", fetchImpl: registry, target: { method: "npx", display: "npx @meterapp/car-image@latest" }, install });
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", fetchImpl: registry, target: { ...target, blocked: "not writable" }, install });
    const offline = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    await runBackgroundUpdate({ ...paths, autoUpdate: "always", fetchImpl: offline, target, install });
    expect(install).not.toHaveBeenCalled();

    expect(acquireUpdateLock(paths.lockPath)).toBe(true);
    expect(await runBackgroundUpdate({ ...paths, autoUpdate: "always", fetchImpl: registry, target, install })).toBeNull();
    releaseUpdateLock(paths.lockPath);
  });

  it("breaks a lock left by a worker that died", async () => {
    expect(acquireUpdateLock(paths.lockPath)).toBe(true);
    expect(acquireUpdateLock(paths.lockPath)).toBe(false);
    const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
    await utimes(paths.lockPath, old, old);
    expect(acquireUpdateLock(paths.lockPath)).toBe(true);
    expect(await readFile(paths.lockPath, "utf8")).toBe("");
  });
});
