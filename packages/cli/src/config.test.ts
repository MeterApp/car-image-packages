import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, isLegacyBaseUrl, maskKey, readConfig, storedBaseUrl, updateCachePath, updateConfig, writeConfig } from "./config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "car-image-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("configPath", () => {
  it("prefers CAR_IMAGE_CONFIG, then XDG_CONFIG_HOME, then ~/.config", () => {
    expect(configPath({ CAR_IMAGE_CONFIG: "/tmp/x/config.json" })).toBe("/tmp/x/config.json");
    expect(configPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" })).toBe(join("/xdg", "car-image-api", "config.json"));
    expect(configPath({ HOME: "/home/u" })).toBe(join("/home/u", ".config", "car-image-api", "config.json"));
    expect(updateCachePath({ CAR_IMAGE_CONFIG: "/tmp/x/config.json" })).toBe("/tmp/x/update-check.json");
  });
});

describe("config file", () => {
  it("writes with mode 0600 and reads back only known keys", async () => {
    const path = join(dir, "nested", "config.json");
    await writeConfig({ apiKey: "cimg_secret", baseUrl: "https://api.test", autoUpdate: "never", telemetry: false, anonymousId: "anon" }, path);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
    }
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(raw.apiKey).toBe("cimg_secret");
    const config = await readConfig(path);
    expect(config).toEqual({ apiKey: "cimg_secret", baseUrl: "https://api.test", autoUpdate: "never", telemetry: false, anonymousId: "anon" });
  });

  it("ignores junk and missing files", async () => {
    expect(await readConfig(join(dir, "missing.json"))).toEqual({});
    const path = join(dir, "config.json");
    await writeConfig({}, path);
    await import("node:fs/promises").then((fs) => fs.writeFile(path, '{"apiKey": 42, "autoUpdate": "sometimes", "extra": true}'));
    expect(await readConfig(path)).toEqual({});
    await import("node:fs/promises").then((fs) => fs.writeFile(path, "not json"));
    expect(await readConfig(path)).toEqual({});
  });

  it("patches and removes keys atomically", async () => {
    const path = join(dir, "config.json");
    await writeConfig({ apiKey: "cimg_one", autoUpdate: "ask" }, path);
    await updateConfig({ telemetry: false }, path);
    expect(await readConfig(path)).toEqual({ apiKey: "cimg_one", autoUpdate: "ask", telemetry: false });
    await updateConfig({ apiKey: undefined }, path);
    expect(await readConfig(path)).toEqual({ autoUpdate: "ask", telemetry: false });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe("the legacy car-imgs.vercel.app base URL", () => {
  it("reads a base URL an old login saved on the alias as no base URL", async () => {
    // `car-image login` before 2026-09-03 wrote the default of the day into the config.
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ apiKey: "cimg_old", baseUrl: "https://car-imgs.vercel.app", anonymousId: "anon" }));
    expect(await readConfig(path)).toEqual({ apiKey: "cimg_old", anonymousId: "anon" });
  });

  it("drops it from the file on the next write", async () => {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ apiKey: "cimg_old", baseUrl: "https://car-imgs.vercel.app/" }));
    await updateConfig({ telemetry: false }, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ apiKey: "cimg_old", telemetry: false });
  });

  it("recognizes the alias however it is written, and nothing else", () => {
    for (const url of ["https://car-imgs.vercel.app", "https://car-imgs.vercel.app/", "http://car-imgs.vercel.app", "https://CAR-IMGS.vercel.app/api"]) {
      expect(isLegacyBaseUrl(url), url).toBe(true);
    }
    for (const url of ["https://carimage.dev", "https://car-imgs-git-main-meterapp.vercel.app", "http://localhost:3000", "not a url", ""]) {
      expect(isLegacyBaseUrl(url), url).toBe(false);
    }
  });

  it("stores a base URL only when it is neither the default nor the alias", () => {
    expect(storedBaseUrl("https://carimage.dev")).toBeUndefined();
    expect(storedBaseUrl("https://car-imgs.vercel.app")).toBeUndefined();
    expect(storedBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("maskKey", () => {
  it("never reveals the middle of a key", () => {
    expect(maskKey("cimg_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toBe("cimg_ABCD…345");
    expect(maskKey("short")).toBe("shor…");
    expect(maskKey(undefined)).toBe("(none)");
  });
});
