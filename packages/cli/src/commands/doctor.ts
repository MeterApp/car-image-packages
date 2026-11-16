import type { CommandContext, CommandDefinition } from "../context.js";
import { doctorSummary, renderDoctorTable, runDoctor, type DoctorCheck } from "../doctor.js";
import { fail, ok, paint, printJson } from "../output.js";
import { confirm } from "../prompts.js";
import { simpleEvent } from "../telemetry.js";

export interface DoctorRunOptions {
  quick?: boolean;
}

/** Shared by `doctor` and onboarding. Returns the exit code. */
export async function runDoctorCommand(ctx: CommandContext, options: DoctorRunOptions = {}): Promise<number> {
  const { io, clientContext } = ctx;
  const yes = ctx.args.flags.yes === true;
  const noImage = ctx.args.flags.image === false || options.quick === true;

  let includeImage = false;
  if (!noImage && clientContext.apiKey) {
    includeImage = yes ? true : await confirm(io, "Also fetch one keyed image to test GET /api/v1/images/car? It counts one vehicle image of the month (1 credit on the legacy credit meter).", false);
  }

  if (!io.json && !io.quiet) {
    io.stderr(`Checking ${clientContext.baseUrl}${options.quick ? " (quick: no paid checks)" : ""}…\n`);
  }

  const checks: DoctorCheck[] = await runDoctor({
    client: clientContext.client,
    publicFetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "User-Agent": clientContext.userAgent } }),
    hasKey: Boolean(clientContext.apiKey),
    now: () => Date.now(),
    includeImage,
    quick: options.quick === true,
    onCheck: (check) => {
      if (io.json || io.quiet || !io.isTTY) return;
      const mark = check.status === "pass" ? paint(io, "green", "✓") : check.status === "fail" ? paint(io, "red", "✗") : paint(io, "dim", "·");
      io.stderr(`${mark} ${check.name}${check.latencyMs !== null ? paint(io, "dim", ` ${check.latencyMs} ms`) : ""}\n`);
    },
  });

  const summary = doctorSummary(checks);
  if (ctx.telemetry.enabled && ctx.telemetry.anonymousId) {
    ctx.emit(simpleEvent(ctx.telemetry.anonymousId, "cli_doctor", { passed: summary.passed, failed: summary.failed, skipped: summary.skipped, quick: options.quick === true }));
  }

  if (io.json) {
    printJson(io, { ok: summary.ok, base_url: clientContext.baseUrl, summary, checks });
    return summary.ok ? 0 : 1;
  }
  if (io.isTTY && !io.quiet) io.stderr("\n");
  io.stdout(`${renderDoctorTable(checks, io)}\n\n`);
  const spent = checks.reduce((total, check) => total + (check.credits ?? 0), 0);
  const line = `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped · ${spent} credit${spent === 1 ? "" : "s"} spent`;
  io.stdout(summary.ok ? `${ok(io, line)}\n` : `${fail(io, line)}\n`);
  return summary.ok ? 0 : 1;
}

export const doctorCommand: CommandDefinition = {
  name: "doctor",
  summary: "Smoke-test every endpoint with your key (uses one vehicle image of the month; exit 1 on failure)",
  usage: "car-image doctor [--json] [--yes] [--no-image]\n  --yes       fetch one keyed image without asking\n  --no-image  skip the keyed image fetch",
  run: (ctx) => runDoctorCommand(ctx),
};
