import { createInterface } from "node:readline/promises";
import type { Io } from "./output.js";

/** y/N confirmation on a TTY; returns `fallback` when stdin is not interactive. */
export async function confirm(io: Pick<Io, "stdinTTY" | "stderr">, question: string, fallback = false): Promise<boolean> {
  if (!io.stdinTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function ask(io: Pick<Io, "stdinTTY" | "stderr">, question: string, fallback = ""): Promise<string> {
  if (!io.stdinTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}
