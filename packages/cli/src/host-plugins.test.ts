import { describe, expect, it } from "vitest";
import { claudeInstalls, codexMarketplaces, refreshHostPlugins, type CommandRunner, type RunResult } from "./host-plugins.js";

const CLAUDE_LIST = JSON.stringify([
  { id: "supabase@claude-plugins-official", version: "0.1.15", scope: "user", enabled: true },
  { id: "car-image@meterapp", version: "1.15.0", scope: "user", enabled: true },
]);

const CODEX_LIST = `Marketplace \`meterapp\`
/Users/me/.codex/.tmp/marketplaces/meterapp/.agents/plugins/marketplace.json

PLUGIN              STATUS              VERSION  SOURCE
car-image@meterapp  installed, enabled  1.15.0   /Users/me/.codex/.tmp/marketplaces/meterapp

Marketplace \`openai-bundled\`
PLUGIN                               STATUS              VERSION       SOURCE
latex@openai-bundled                 not installed                     /Users/me/latex
`;

function fakeRunner(answers: Record<string, RunResult>): { run: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    return answers[line] ?? { code: 127, stdout: "", stderr: `${command}: command not found` };
  };
  return { run, calls };
}

describe("host plugin installs", () => {
  it("reads Claude Code's JSON list and Codex's table", () => {
    expect(claudeInstalls(CLAUDE_LIST, "car-image")).toEqual([{ id: "car-image@meterapp", marketplace: "meterapp", scope: "user" }]);
    expect(claudeInstalls("not json", "car-image")).toEqual([]);
    expect(codexMarketplaces(CODEX_LIST, "car-image")).toEqual(["meterapp"]);
    expect(codexMarketplaces(CODEX_LIST, "latex")).toEqual([]);
  });

  it("refreshes the marketplace, then the plugin, in each host that has it", async () => {
    const { run, calls } = fakeRunner({
      "claude plugin list --json": { code: 0, stdout: CLAUDE_LIST, stderr: "" },
      "claude plugin marketplace update meterapp --json": { code: 0, stdout: "", stderr: "" },
      "claude plugin update car-image@meterapp --json --scope user": { code: 0, stdout: '{"command":"update","outcome":"updated","message":"Updated car-image from 1.15.0 to 1.16.0"}\n', stderr: "" },
      "codex plugin list": { code: 0, stdout: CODEX_LIST, stderr: "" },
      "codex plugin marketplace upgrade meterapp": { code: 0, stdout: "Upgraded marketplace `meterapp`\n", stderr: "" },
    });
    expect(await refreshHostPlugins("car-image", run)).toEqual([
      { host: "Claude Code", id: "car-image@meterapp", ok: true, detail: "Updated car-image from 1.15.0 to 1.16.0" },
      { host: "Codex", id: "car-image@meterapp", ok: true, detail: "Upgraded marketplace `meterapp`" },
    ]);
    expect(calls).toEqual([
      "claude plugin list --json",
      "claude plugin marketplace update meterapp --json",
      "claude plugin update car-image@meterapp --json --scope user",
      "codex plugin list",
      "codex plugin marketplace upgrade meterapp",
    ]);
  });

  it("skips a host that is missing or lacks the plugin, and reports a marketplace that failed", async () => {
    expect(await refreshHostPlugins("car-image", fakeRunner({}).run)).toEqual([]);
    const { run, calls } = fakeRunner({
      "claude plugin list --json": { code: 0, stdout: CLAUDE_LIST, stderr: "" },
      "claude plugin marketplace update meterapp --json": { code: 1, stdout: '{"outcome":"failed","message":"could not fetch MeterApp/car-image-plugins"}\n', stderr: "" },
      "codex plugin list": { code: 0, stdout: "Marketplace `openai-bundled`\n", stderr: "" },
    });
    expect(await refreshHostPlugins("car-image", run)).toEqual([{ host: "Claude Code", id: "car-image@meterapp", ok: false, detail: "marketplace meterapp: could not fetch MeterApp/car-image-plugins" }]);
    expect(calls).not.toContain("claude plugin update car-image@meterapp --json --scope user");
  });
});
