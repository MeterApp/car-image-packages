import util from "node:util";

import { CREDITS_PER_DOLLAR } from "@meterapp/car-image-sdk";

import type { FlagValue } from "./args.js";
import type { Env } from "./config.js";

export type Style = "bold" | "dim" | "green" | "red" | "yellow" | "cyan" | "magenta" | "gray" | "underline";

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  isTTY: boolean;
  stdinTTY: boolean;
  color: boolean;
  json: boolean;
  quiet: boolean;
}

export function createIo(flags: Record<string, FlagValue>, env: Env = process.env): Io {
  const isTTY = Boolean(process.stdout.isTTY);
  const colorFlag = flags["color-output"];
  const color =
    colorFlag === false
      ? false
      : env.NO_COLOR !== undefined
        ? false
        : env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0"
          ? true
          : isTTY;
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    isTTY,
    stdinTTY: Boolean(process.stdin.isTTY),
    color,
    json: flags.json === true,
    quiet: flags.quiet === true,
  };
}

/** Colors via `util.styleText` (Node 20.12+); plain text elsewhere or when disabled. */
export function paint(io: Pick<Io, "color">, style: Style | Style[], text: string): string {
  const { styleText } = util;
  if (!io.color || typeof styleText !== "function") return text;
  try {
    return styleText(style, text);
  } catch {
    return text;
  }
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

function pad(text: string, width: number): string {
  const missing = width - visibleLength(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

/** Fixed-width table via padEnd; header row underlined with dashes. */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return "";
  const columns = Math.max(...all.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(...all.map((row) => visibleLength(String(row[column] ?? "")))));
  const render = (row: string[]) =>
    row.map((cell, column) => (column === columns - 1 ? String(cell ?? "") : pad(String(cell ?? ""), widths[column] ?? 0))).join("  ").trimEnd();
  const lines: string[] = [];
  if (header) {
    lines.push(render(header));
    lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  }
  for (const row of rows) lines.push(render(row));
  return lines.join("\n");
}

/** Two-column key/value block. */
export function keyValues(io: Pick<Io, "color">, entries: Array<[string, string]>): string {
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `${paint(io, "dim", pad(key, width))}  ${value}`).join("\n");
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

/** `1234` credits → `$1.23`. */
export function creditsToUsd(credits: number | null | undefined, creditsPerDollar = CREDITS_PER_DOLLAR): string {
  if (credits === null || credits === undefined || !Number.isFinite(credits)) return "—";
  return `$${(credits / creditsPerDollar).toFixed(2)}`;
}

export function printJson(io: Io, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function ok(io: Io, text: string): string {
  return `${paint(io, "green", "✓")} ${text}`;
}

export function warn(io: Io, text: string): string {
  return `${paint(io, "yellow", "!")} ${text}`;
}

export function fail(io: Io, text: string): string {
  return `${paint(io, "red", "✗")} ${text}`;
}
