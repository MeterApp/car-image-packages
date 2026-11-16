import type { CommandContext, CommandDefinition } from "../context.js";
import { paint } from "../output.js";
import { runDoctorCommand } from "./doctor.js";

/**
 * `car-image` with no arguments on a TTY: login if needed, show the account,
 * run a quick (free) health check and print the next steps.
 */
export const onboardCommand: CommandDefinition = {
  name: "onboard",
  summary: "Interactive setup: login → account → quick check → next steps (default with no arguments)",
  usage: "car-image [onboard]",
  async run(ctx: CommandContext): Promise<number> {
    const { io } = ctx;
    io.stdout(`${paint(io, "bold", "Car Image API")} — studio-quality vehicle renders for agents, apps and browsers.\nFree 30 vehicle images per account · Pro $49/mo 2,500 · Business $99/mo 10,000 · each image (a vehicle in one color from one angle) as often as you like, any size\n\n`);

    if (!ctx.clientContext.apiKey) {
      io.stdout(`${paint(io, "bold", "Step 1/3")} Sign in\n`);
      const code = await ctx.runCommand("login", []);
      if (code !== 0) return code;
      io.stdout("\n");
    } else {
      io.stdout(`${paint(io, "bold", "Step 1/3")} Signed in (${ctx.clientContext.keySource} key).\n\n`);
    }

    io.stdout(`${paint(io, "bold", "Step 2/3")} Account\n`);
    const whoami = await ctx.runCommand("whoami", []);
    if (whoami !== 0) return whoami;

    io.stdout(`\n${paint(io, "bold", "Step 3/3")} Quick check (free)\n`);
    const doctor = await runDoctorCommand({ ...ctx, args: { ...ctx.args, flags: { ...ctx.args.flags, image: false } } }, { quick: true });

    io.stdout(`\n${paint(io, "bold", "Next steps")}\n`);
    io.stdout(
      [
        "  car-image get --make Porsche --model 911 --year 2024 --view side --color red --out porsche.png",
        "  car-image url --make BMW --model M3 --year 2022 --ttl 86400        # signed URL for a web page",
        "  car-image resolve red 2024 porsche 911 side view                    # free text → parameters",
        "  car-image agent-config --host claude-code                           # MCP setup for agents",
        "  car-image describe                                                  # the REST API, explained",
        "  Docs: https://carimage.dev/docs?ref=cli · Agents: https://carimage.dev/agents.md",
      ].join("\n") + "\n"
    );
    return doctor;
  },
};
