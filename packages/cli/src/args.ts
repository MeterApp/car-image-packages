import { CliError } from "./errors.js";

export type FlagValue = string | boolean;

export interface ParsedArgs {
  /** First positional token, or null when none was given. */
  command: string | null;
  /** Remaining positional tokens after the command. */
  positionals: string[];
  flags: Record<string, FlagValue>;
}

/** Flags that never take a value. `--no-<flag>` sets them to false. */
export const BOOLEAN_FLAGS = new Set([
  "json",
  "quiet",
  "help",
  "all",
  "version",
  "yes",
  "portal",
  "report-gap",
  "yearly",
  "good",
  "bad",
  "url",
  "check",
  "worker",
  "plugins",
  "remote",
  "browser",
  "image",
  "color-output",
  "force",
  "renew",
  "shadow",
  "trim",
  "wait",
  "allow-partial",
]);

const SHORT_FLAGS: Record<string, string> = {
  h: "help",
  v: "version",
  q: "quiet",
  y: "yes",
  o: "out",
};

/**
 * Hand-rolled argv parser: `--flag`, `--flag value`, `--flag=value`,
 * `--no-flag`, `-h`, `-v`, and `--` to end flag parsing. Boolean flags never
 * consume the following token, so `car-image get --json --make Porsche` works.
 */
export function parseArgs(argv: readonly string[], booleanFlags: ReadonlySet<string> = BOOLEAN_FLAGS): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (onlyPositionals || token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals >= 0) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (body.startsWith("no-") && body.length > 3) {
        flags[body.slice(3)] = false;
        continue;
      }
      if (booleanFlags.has(body)) {
        flags[body] = true;
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && (next === "-" || !next.startsWith("-") || /^-\d/.test(next))) {
        flags[body] = next;
        index += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }
    // Short flags: -h, -v, -q, -y, -o file
    const letters = token.slice(1);
    for (let position = 0; position < letters.length; position += 1) {
      const letter = letters[position] ?? "";
      const name = SHORT_FLAGS[letter];
      if (!name) throw new CliError(`Unknown option -${letter}`, 2, "Run `car-image --help` for usage.");
      if (booleanFlags.has(name)) {
        flags[name] = true;
      } else {
        const rest = letters.slice(position + 1);
        const next = rest || argv[index + 1];
        if (next === undefined) throw new CliError(`Option -${letter} requires a value`, 2);
        flags[name] = next;
        if (!rest) index += 1;
        break;
      }
    }
  }

  const [command = null, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

export function flagString(flags: Record<string, FlagValue>, name: string): string | undefined {
  const value = flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new CliError(`Option --${name} requires a value`, 2);
  return value;
}

export function requireString(flags: Record<string, FlagValue>, name: string, hint?: string): string {
  const value = flagString(flags, name);
  if (value === undefined || value === "") {
    throw new CliError(`Missing required option --${name}`, 2, hint ?? "Run `car-image --help` for usage.");
  }
  return value;
}

export function flagNumber(flags: Record<string, FlagValue>, name: string): number | undefined {
  const raw = flagString(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliError(`Option --${name} must be a number (received "${raw}")`, 2);
  return value;
}

export function flagInteger(flags: Record<string, FlagValue>, name: string, bounds?: { min?: number; max?: number }): number | undefined {
  const value = flagNumber(flags, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new CliError(`Option --${name} must be an integer`, 2);
  if (bounds?.min !== undefined && value < bounds.min) throw new CliError(`Option --${name} must be at least ${bounds.min}`, 2);
  if (bounds?.max !== undefined && value > bounds.max) throw new CliError(`Option --${name} must be at most ${bounds.max}`, 2);
  return value;
}

export function flagBoolean(flags: Record<string, FlagValue>, name: string): boolean {
  return flags[name] === true;
}

export function flagChoice<T extends string>(flags: Record<string, FlagValue>, name: string, choices: readonly T[]): T | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!(choices as readonly string[]).includes(normalized)) {
    throw new CliError(`Invalid --${name} "${value}". Choose one of: ${choices.join(", ")}`, 2);
  }
  return normalized as T;
}
