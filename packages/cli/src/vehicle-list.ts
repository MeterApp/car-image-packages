import type { VehicleCheckEntry, VehicleCheckResponse, VehicleCheckResult } from "@meterapp/car-image-sdk";
import { CliError } from "./errors.js";

/**
 * Lists of vehicles as people keep them, for `car-image check`: a CSV (or
 * TSV) export of a catalog, or JSON. Read into the entries the check takes,
 * and written back with each row's answer beside it, so the file a catalog
 * came from becomes the file that maps it to vehicle ids.
 */

export interface VehicleList {
  format: "csv" | "json";
  entries: VehicleCheckEntry[];
  /** CSV only: the columns as the file names them (or make, model, year when it names none), the rows, and the separator. */
  header?: string[];
  rows?: string[][];
  delimiter?: string;
}

/** Header spellings of each field, after lowercasing and turning spaces and hyphens into underscores. */
const COLUMNS: Record<"make" | "model" | "year" | "vehicle" | "ref", readonly string[]> = {
  make: ["make", "brand", "manufacturer"],
  model: ["model"],
  year: ["year", "model_year"],
  vehicle: ["vehicle", "vehicle_id"],
  ref: ["ref"],
};

const YEAR = /^\s*(?:19|20)\d{2}\s*$/;

function columnKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * RFC 4180 fields: quotes around a field that holds the separator, a quote
 * or a line break, `""` for a quote inside one. Blank lines are skipped and a
 * byte order mark is dropped.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  const source = text.replace(/^﻿/, "");
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    field = "";
    started = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      started = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRow();
    } else {
      field += char;
      started = true;
    }
  }
  if (quoted) throw new CliError("The CSV ends inside a quoted field", 2, 'Close every quote: a field with a comma is written "like, this".');
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** The separator a header line uses: whichever of comma, tab and semicolon it holds most of. */
export function detectDelimiter(firstLine: string): string {
  const counts = [",", "\t", ";"].map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length - 1 }));
  return counts.reduce((best, entry) => (entry.count > best.count ? entry : best)).delimiter;
}

function fromJson(text: string): VehicleList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("The file is not valid JSON", 2, 'Expected an array of {"make","model","year"} or {"vehicle"} objects, or {"vehicles": [...]}.');
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { vehicles?: unknown }).vehicles)
      ? (parsed as { vehicles: unknown[] }).vehicles
      : null;
  if (!list) throw new CliError('The JSON must be an array of vehicles or {"vehicles": [...]}', 2);
  // Entries go to the API as they are: it answers one it cannot read as invalid, on its own.
  return { format: "json", entries: list as VehicleCheckEntry[] };
}

function fromCsv(text: string): VehicleList {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const table = parseCsv(text, delimiter);
  const [first] = table;
  if (!first) throw new CliError("The file has no rows", 2);
  const named = first.map(columnKey);
  const find = (field: keyof typeof COLUMNS) => named.findIndex((name) => COLUMNS[field].includes(name));
  let columns = { make: find("make"), model: find("model"), year: find("year"), vehicle: find("vehicle"), ref: find("ref") };
  let header = first;
  let rows = table.slice(1);
  if (columns.make < 0 && columns.model < 0 && columns.vehicle < 0) {
    // No header: "Toyota,Corolla,2019" rows are make, model and year, then a ref.
    if (first.length < 3 || !YEAR.test(first[2] ?? "")) {
      throw new CliError(
        "The first row must name the columns: make, model and year, or vehicle for stored ids",
        2,
        "For example: make,model,year,ref. A ref column (your row id or SKU) is echoed back beside each answer."
      );
    }
    columns = { make: 0, model: 1, year: 2, vehicle: -1, ref: first.length > 3 ? 3 : -1 };
    header = ["make", "model", "year", ...(first.length > 3 ? ["ref"] : [])];
    rows = table;
  }
  const cell = (row: string[], index: number) => (index >= 0 ? row[index]?.trim() || undefined : undefined);
  const entries = rows.map((row) => {
    const entry: VehicleCheckEntry = {};
    const vehicle = cell(row, columns.vehicle);
    // A row with a stored id and names too is checked by the id, the value that never changes.
    if (vehicle) entry.vehicle = vehicle;
    else {
      const make = cell(row, columns.make);
      const model = cell(row, columns.model);
      const year = cell(row, columns.year);
      if (make !== undefined) entry.make = make;
      if (model !== undefined) entry.model = model;
      if (year !== undefined) entry.year = year;
    }
    const ref = cell(row, columns.ref);
    if (ref !== undefined) entry.ref = ref;
    return entry;
  });
  return { format: "csv", entries, header, rows, delimiter };
}

/** A list from the text of a file: JSON when it opens with `[` or `{` (or `format` says so), CSV otherwise. */
export function parseVehicleList(text: string, format?: "csv" | "json"): VehicleList {
  const json = format ? format === "json" : /^\s*[[{]/.test(text.replace(/^﻿/, ""));
  const list = json ? fromJson(text) : fromCsv(text);
  if (list.entries.length === 0) throw new CliError("The list has no vehicles", 2);
  return list;
}

/** Answer columns a CSV gains, after the file's own; one the file already has is prefixed with `check_`. */
const ANSWER_COLUMNS = ["status", "vehicle_id", "catalog_make", "catalog_model", "catalog_year", "match", "reason", "suggested_vehicle_id", "suggestions", "error"] as const;
/** The columns a check with `--views` adds: prepared views (0-9), the missing ones and the verified ones, space-separated. */
const VIEW_COLUMNS = ["views_prepared", "views_missing", "views_verified"] as const;

function csvField(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function answerCells(result: VehicleCheckResult, views: boolean): string[] {
  const suggestions = result.suggestions ?? [];
  const suggested = suggestions.find((suggestion) => suggestion.id);
  const viewCells = views ? [result.views ? String(result.views.prepared) : "", result.views?.missing.join(" ") ?? "", result.views?.verified?.join(" ") ?? ""] : [];
  return [
    result.status,
    result.vehicle?.id ?? "",
    result.vehicle?.make ?? "",
    result.vehicle?.model ?? "",
    result.vehicle ? String(result.vehicle.year) : "",
    result.vehicle?.match ?? "",
    result.reason ?? "",
    suggested?.id ?? "",
    suggestions.map((suggestion) => `${suggestion.make}/${suggestion.model ?? ""} ${suggestion.year}${suggestion.id ? ` ${suggestion.id}` : ""}`).join(" | "),
    result.error ?? "",
    ...viewCells,
  ];
}

/** The answer columns a CSV gains, named clear of the file's own; with `views`, the three view columns too. */
export function answerColumns(list: VehicleList, views = false): string[] {
  const taken = new Set((list.header ?? []).map(columnKey));
  return [...ANSWER_COLUMNS, ...(views ? VIEW_COLUMNS : [])].map((name) => (taken.has(name) ? `check_${name}` : name));
}

/**
 * The CSV a list came from, every row followed by its answer (`vehicle_id` is
 * the id to store); a check with `views` adds `views_prepared`, `views_missing`
 * and `views_verified`.
 */
export function writeCheckedCsv(list: VehicleList, results: readonly VehicleCheckResult[], views = false): string {
  const header = list.header ?? [];
  const delimiter = list.delimiter ?? ",";
  const answers = answerColumns(list, views);
  const byIndex = new Map(results.map((result) => [result.index, result]));
  const lines = [[...header, ...answers]];
  for (const [index, row] of (list.rows ?? []).entries()) {
    const result = byIndex.get(index);
    const padded = header.map((_, column) => row[column] ?? "");
    lines.push([...padded, ...(result ? answerCells(result, views) : answers.map(() => ""))]);
  }
  return `${lines.map((line) => line.map((value) => csvField(value, delimiter)).join(delimiter)).join("\n")}\n`;
}

/** The check as JSON, each answer carrying the entry it answers as `input`. */
export function checkedJson(list: VehicleList, response: VehicleCheckResponse): unknown {
  return {
    ...response,
    data: {
      ...response.data,
      results: response.data.results.map((result) => ({ ...result, input: list.entries[result.index] })),
    },
  };
}
