import type { VehicleCheckResponse, VehicleCheckResult } from "@meterapp/car-image-sdk";
import { describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { answerColumns, checkedJson, detectDelimiter, parseCsv, parseVehicleList, writeCheckedCsv } from "./vehicle-list.js";

const MATCH: VehicleCheckResult = {
  index: 0,
  status: "match",
  vehicle: { id: "veh_59854qbgfvar3", make: "mazda", make_name: "Mazda", model: "mx-5", model_name: "MX-5", year: 2018, match: "alias", image_path: "/api/v1/images/car?vehicle=veh_59854qbgfvar3" },
};
const SUGGESTION: VehicleCheckResult = {
  index: 1,
  status: "suggestion",
  vehicle: null,
  reason: "year",
  suggestions: [{ make: "lexus", make_name: "Lexus", model: "tx-350", model_name: "TX 350", year: 2024, id: "veh_8bbz514ey4ran", image_path: "/api/v1/images/car?vehicle=veh_8bbz514ey4ran" }],
};

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, CRLF, a byte order mark and blank lines", () => {
    expect(parseCsv('﻿make,model,year\r\n"Mercedes-Benz","C 300, 4MATIC",2020\r\n\r\nFord,"F-150 ""Raptor""",2023\n')).toEqual([
      ["make", "model", "year"],
      ["Mercedes-Benz", "C 300, 4MATIC", "2020"],
      ["Ford", 'F-150 "Raptor"', "2023"],
    ]);
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(() => parseCsv('make\n"open')).toThrow(CliError);
  });

  it("finds the separator a header uses", () => {
    expect(detectDelimiter("make,model,year")).toBe(",");
    expect(detectDelimiter("make\tmodel\tyear")).toBe("\t");
    expect(detectDelimiter("make;model;year")).toBe(";");
  });
});

describe("parseVehicleList", () => {
  it("maps a CSV's columns by name, in any case and order, and keeps its rows", () => {
    const list = parseVehicleList("SKU,Year,Brand,Model,Ref,Price\nA1,2018,Mazda,MX-5 Miata,row-1,19000\nA2,2022,Lexus,TX 350,,\n");
    expect(list.format).toBe("csv");
    expect(list.entries).toEqual([
      { make: "Mazda", model: "MX-5 Miata", year: "2018", ref: "row-1" },
      { make: "Lexus", model: "TX 350", year: "2022" },
    ]);
    expect(list.header).toEqual(["SKU", "Year", "Brand", "Model", "Ref", "Price"]);
    expect(list.rows).toHaveLength(2);
  });

  it("checks a stored id by the id, reads model_year and tab-separated files", () => {
    expect(parseVehicleList("vehicle_id\tmake\tmodel\tmodel year\nveh_395yw8tn73ff8\tFord\tF-150\t2023\n\tToyota\tCorolla\t2020\n").entries).toEqual([
      { vehicle: "veh_395yw8tn73ff8" },
      { make: "Toyota", model: "Corolla", year: "2020" },
    ]);
  });

  it("reads rows without a header as make, model, year and ref", () => {
    const list = parseVehicleList("Toyota,Corolla,2019,sku-9\nHonda,Civic,2020,sku-10\n");
    expect(list.header).toEqual(["make", "model", "year", "ref"]);
    expect(list.entries[0]).toEqual({ make: "Toyota", model: "Corolla", year: "2019", ref: "sku-9" });
    expect(list.rows).toHaveLength(2);
    expect(() => parseVehicleList("name,price\nCorolla,20000\n")).toThrow(/must name the columns/);
  });

  it("reads JSON as a list or {vehicles}, passing entries on as they are", () => {
    expect(parseVehicleList('[{"make":"Kia","model":"EV6","year":2024,"ref":7}]').entries).toEqual([{ make: "Kia", model: "EV6", year: 2024, ref: 7 }]);
    expect(parseVehicleList('{"vehicles":[{"vehicle":"veh_395yw8tn73ff8"}, "junk"]}').entries).toEqual([{ vehicle: "veh_395yw8tn73ff8" }, "junk"]);
    expect(parseVehicleList("make,model,year\nKia,EV6,2024", "csv").format).toBe("csv");
    expect(() => parseVehicleList("{nope")).toThrow(/not valid JSON/);
    expect(() => parseVehicleList('{"images":[]}')).toThrow(/array of vehicles/);
    expect(() => parseVehicleList("[]")).toThrow(/no vehicles/);
    expect(() => parseVehicleList("make,model,year\n")).toThrow(/no vehicles/);
  });
});

describe("writing the answers back", () => {
  it("appends the answer to each CSV row, quoting what needs it, clear of the file's own columns", () => {
    const list = parseVehicleList('make,model,year,status\nMazda,"MX-5 Miata",2018,listed\nLexus,TX 350,2022,draft\n');
    expect(answerColumns(list)[0]).toBe("check_status");
    const csv = writeCheckedCsv(list, [MATCH, SUGGESTION]);
    const [header, first, second] = parseCsv(csv);
    expect(header).toEqual(["make", "model", "year", "status", "check_status", "vehicle_id", "catalog_make", "catalog_model", "catalog_year", "match", "reason", "suggested_vehicle_id", "suggestions", "error"]);
    expect(first).toEqual(["Mazda", "MX-5 Miata", "2018", "listed", "match", "veh_59854qbgfvar3", "mazda", "mx-5", "2018", "alias", "", "", "", ""]);
    expect(second).toEqual(["Lexus", "TX 350", "2022", "draft", "suggestion", "", "", "", "", "", "year", "veh_8bbz514ey4ran", "lexus/tx-350 2024 veh_8bbz514ey4ran", ""]);
  });

  it("writes a semicolon file back with semicolons, and JSON with each entry beside its answer", () => {
    const list = parseVehicleList("make;model;year\nMazda;MX-5;2018\n");
    expect(writeCheckedCsv(list, [MATCH]).split("\n")[1]).toBe("Mazda;MX-5;2018;match;veh_59854qbgfvar3;mazda;mx-5;2018;alias;;;;");
    const response: VehicleCheckResponse = { data: { summary: { total: 1, match: 1, suggestion: 0, miss: 0, invalid: 0, distinct_vehicles: 1 }, results: [MATCH] }, request_id: "req" };
    expect(checkedJson(list, response)).toMatchObject({ data: { results: [{ status: "match", input: { make: "Mazda", model: "MX-5", year: "2018" } }] }, request_id: "req" });
  });
});
