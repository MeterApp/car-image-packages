import { flagString } from "../args.js";
import { openBrowser } from "../browser.js";
import { maskKey, storedBaseUrl, updateConfig } from "../config.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { runDeviceLogin } from "../device-login.js";
import { keyValues, ok, paint, printJson } from "../output.js";
import { simpleEvent } from "../telemetry.js";

export const loginCommand: CommandDefinition = {
  name: "login",
  summary: "Sign in through the browser (device flow) and store a key with mode 0600",
  usage: "car-image login [--no-browser] [--client-name <name>]",
  async run(ctx: CommandContext): Promise<number> {
    const { io, clientContext } = ctx;
    const openInBrowser = ctx.args.flags.browser !== false;
    const clientName = flagString(ctx.args.flags, "client-name") ?? `car-image CLI (${process.platform})`;

    const result = await runDeviceLogin({
      start: () => clientContext.client.startDeviceLogin({ clientName }),
      poll: (deviceCode) => clientContext.client.pollDeviceLogin(deviceCode),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      onCode(info) {
        io.stderr(`\nApprove this CLI in your browser:\n  ${paint(io, "underline", info.verification_uri_complete)}\n\nCode: ${paint(io, "bold", info.user_code)}\n`);
        if (openInBrowser) {
          const opened = openBrowser(info.verification_uri_complete);
          io.stderr(opened ? "Opening your browser… (use --no-browser to skip)\n" : "Open the link above in a browser.\n");
        }
        io.stderr(`Waiting for approval (expires in ${Math.round(info.expires_in / 60)} min)…\n`);
      },
    });

    // The default is not written down: a stored default pinned every login
    // before 2026-09-03 to the pre-launch Vercel alias for good.
    await updateConfig({ apiKey: result.accessToken, baseUrl: storedBaseUrl(clientContext.baseUrl) }, ctx.configPath);
    if (ctx.telemetry.enabled && ctx.telemetry.anonymousId) {
      ctx.emit(simpleEvent(ctx.telemetry.anonymousId, "cli_login"));
    }

    const scopes = result.scope ? result.scope.split(/[\s,]+/).filter(Boolean) : [];
    if (io.json) {
      printJson(io, { ok: true, api_key: result.accessToken, key_prefix: maskKey(result.accessToken), scopes, config_path: ctx.configPath, base_url: clientContext.baseUrl });
      return 0;
    }
    io.stdout(`\n${ok(io, "Signed in.")}\n`);
    io.stdout(
      `${keyValues(io, [
        ["API key", `${result.accessToken}  ${paint(io, "dim", "(shown once; stored below)")}`],
        ["Saved to", `${ctx.configPath} (mode 0600)`],
        ["Scopes", scopes.join(", ") || "images:read account:read billing:write"],
        ["Base URL", clientContext.baseUrl],
      ])}\n`
    );
    io.stdout(`\nFor agents: export CAR_IMAGE_API_KEY=${maskKey(result.accessToken)} (full key above) or run \`car-image agent-config\`.\nNext: car-image whoami · car-image get --make Porsche --model 911 --year 2024 · car-image doctor\n`);
    return 0;
  },
};

export const logoutCommand: CommandDefinition = {
  name: "logout",
  summary: "Remove the stored key from the config file",
  usage: "car-image logout",
  async run(ctx: CommandContext): Promise<number> {
    const hadKey = Boolean(ctx.config.apiKey);
    await updateConfig({ apiKey: undefined }, ctx.configPath);
    if (ctx.io.json) {
      printJson(ctx.io, { ok: true, removed: hadKey, config_path: ctx.configPath });
      return 0;
    }
    ctx.io.stdout(hadKey ? `${ok(ctx.io, `Signed out; key removed from ${ctx.configPath}.`)}\nIf the key may have leaked, revoke it in the dashboard: ${ctx.clientContext.baseUrl}/dashboard?ref=cli#keys\n` : `No stored key in ${ctx.configPath}.\n`);
    return 0;
  },
};
