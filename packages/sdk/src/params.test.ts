import { describe, expect, it } from "vitest";
import { colorParam, imageRequestBody, imageSearchParams, isColor, isCssColorName, normalizeMarket, normalizeYear, parseView, suggestedFileName, vehicleRequestBody } from "./params.js";
import { CSS_COLOR_NAMES, VIEWS } from "./types.js";

describe("params", () => {
  it("normalizes years from numbers and strings", () => {
    expect(normalizeYear(2024)).toBe(2024);
    expect(normalizeYear(" 2019 ")).toBe(2019);
    expect(() => normalizeYear("24")).toThrow(TypeError);
    expect(() => normalizeYear(2024.5)).toThrow(TypeError);
  });

  it("sends the market of sale in upper case, in the query and the body, and only when given", () => {
    expect(normalizeMarket("au")).toBe("AU");
    expect(normalizeMarket(" Gb ")).toBe("GB");
    for (const value of ["", "AUS", "A1", "australia", 61, null]) expect(() => normalizeMarket(value), String(value)).toThrow(TypeError);
    const params = { vehicle: "veh_395yw8tn73ff8", view: "side" as const, market: "au" };
    expect(imageSearchParams(params).toString()).toBe("vehicle=veh_395yw8tn73ff8&view=side&market=AU");
    expect(imageRequestBody(params)).toEqual({ vehicle: "veh_395yw8tn73ff8", view: "side", market: "AU" });
    expect(imageSearchParams({ vehicle: "veh_395yw8tn73ff8" }).has("market")).toBe(false);
    expect(imageRequestBody({ vehicle: "veh_395yw8tn73ff8" })).not.toHaveProperty("market");
    expect(() => imageSearchParams({ vehicle: "veh_395yw8tn73ff8", market: "australia" })).toThrow(/ISO 3166-1 alpha-2/);
    // The file a caller saves is named by the image, not by the market it was asked under.
    expect(suggestedFileName({ make: "Ford", model: "Ranger", year: 2022, market: "AU" })).toBe(suggestedFileName({ make: "Ford", model: "Ranger", year: 2022 }));
  });

  it("builds the canonical query string", () => {
    const search = imageSearchParams({ make: " Alfa Romeo ", model: "Giulia", year: "2021", view: "rear-3-4", color: "green", width: 640, height: 640, format: "webp" });
    expect(search.toString()).toBe("make=Alfa+Romeo&model=Giulia&year=2021&view=rear-3-4&color=green&w=640&h=640&format=webp");
  });

  it("carries the delivery options in the query and the body", () => {
    const params = { make: "a", model: "b", year: 2000, width: 600, height: 400, fit: "cover" as const, background: "#F4F4F4", trim: true, padding: 8, format: "auto" as const };
    expect(imageSearchParams(params).toString()).toBe("make=a&model=b&year=2000&w=600&h=400&fit=cover&background=F4F4F4&trim=1&padding=8&format=auto");
    expect(imageRequestBody(params)).toEqual({ make: "a", model: "b", year: 2000, width: 600, height: 400, fit: "cover", background: "#F4F4F4", trim: true, padding: 8, format: "auto" });
    const shadowed = { make: "a", model: "b", year: 2000, trim: true, shadow: true, format: "webp" as const };
    expect(imageSearchParams(shadowed).toString()).toBe("make=a&model=b&year=2000&trim=1&shadow=1&format=webp");
    expect(imageRequestBody(shadowed)).toEqual({ make: "a", model: "b", year: 2000, trim: true, shadow: true, format: "webp" });
    expect(imageSearchParams({ make: "a", model: "b", year: 2000, shadow: false }).has("shadow")).toBe(false);
    // Padding without trim pads the stored frame.
    expect(imageSearchParams({ make: "a", model: "b", year: 2000, padding: 8 }).get("padding")).toBe("8");
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, padding: 8 }).padding).toBe(8);
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, trim: true, padding: 51 })).toThrow(RangeError);
  });

  it("sends the box presets as they are, and refuses them beside size or with an unknown value", () => {
    const base = { make: "a", model: "b", year: 2000 };
    const search = imageSearchParams({ ...base, aspectRatio: "16:9", resolution: "hd" });
    expect(search.get("aspect_ratio")).toBe("16:9");
    expect(search.get("resolution")).toBe("hd");
    expect(imageRequestBody({ ...base, aspectRatio: "natural", resolution: "2k" })).toMatchObject({ aspect_ratio: "natural", resolution: "2k" });
    expect(() => imageSearchParams({ ...base, aspectRatio: "16:9", size: "large" })).toThrow(/size/);
    expect(() => imageSearchParams({ ...base, resolution: "hd", size: "large" })).toThrow(/size/);
    expect(() => imageSearchParams({ ...base, aspectRatio: "2:1" as never })).toThrow(RangeError);
    expect(() => imageSearchParams({ ...base, resolution: "4k" as never })).toThrow(RangeError);
  });

  it("sends a framing preset as it is, and refuses it beside trim or padding", () => {
    const framed = { make: "a", model: "b", year: 2000, width: 800, height: 600, framing: "balanced" as const };
    expect(imageSearchParams(framed).toString()).toBe("make=a&model=b&year=2000&w=800&h=600&framing=balanced");
    expect(imageRequestBody(framed)).toEqual({ make: "a", model: "b", year: 2000, width: 800, height: 600, framing: "balanced" });
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, framing: "tight", trim: true })).toThrow(/framing replaces trim and padding/);
    expect(() => imageRequestBody({ make: "a", model: "b", year: 2000, framing: "consistent", trim: true, padding: 4 })).toThrow(TypeError);
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, framing: "cover" as never })).toThrow(RangeError);
  });

  it("maps size presets to width only when no explicit dimensions are given", () => {
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, size: "medium" })).toEqual({ make: "a", model: "b", year: 2000, width: 768 });
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, size: "medium", height: 100 })).toEqual({ make: "a", model: "b", year: 2000, height: 100 });
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, size: "medium", width: 100 })).toEqual({ make: "a", model: "b", year: 2000, width: 100 });
  });

  it("suggests tidy file names", () => {
    expect(suggestedFileName({ make: "Porsche", model: "911", year: 2024 })).toBe("2024-porsche-911-front-3-4.png");
    expect(suggestedFileName({ make: "Citroën", model: "C4 Cactus", year: 2018, view: "side", color: "red", format: "webp" })).toBe("2018-citroen-c4-cactus-side-red.webp");
    // A hex paint appears bare and lowercase; a vehicle id stands in for year-make-model.
    expect(suggestedFileName({ make: "Porsche", model: "911", year: 2024, color: "#1A2B3C" })).toBe("2024-porsche-911-front-3-4-1a2b3c.png");
    expect(suggestedFileName({ vehicle: "veh_395yw8tn73ff8", view: "rear", color: "Silver" })).toBe("veh_395yw8tn73ff8-rear.png");
  });

  it("recognizes preset, CSS and hex colors and spells them for the wire", () => {
    expect(isColor("red")).toBe(true);
    expect(isColor("Burgundy")).toBe(true);
    expect(isColor("#1a2b3c")).toBe(true);
    expect(isColor("1A2B3C")).toBe(true);
    expect(isColor("#abc")).toBe(true);
    // The server reads grey as the gray preset and every other CSS name as its hex.
    expect(isColor("grey")).toBe(true);
    expect(isColor("navy")).toBe(true);
    expect(isColor("Light Grey")).toBe(true);
    expect(isCssColorName("dark_blue")).toBe(true);
    expect(CSS_COLOR_NAMES).toHaveLength(148);
    expect(isColor("navyish")).toBe(false);
    expect(isColor("transparent")).toBe(false);
    expect(isColor("#12345")).toBe(false);
    expect(isColor(7)).toBe(false);
    expect(colorParam("Red")).toBe("red");
    expect(colorParam("Navy")).toBe("navy");
    expect(colorParam("#1A2B3C")).toBe("1a2b3c");
    expect(colorParam(" abc ")).toBe("abc");
  });

  it("reads a view alias the way the server does", () => {
    expect(parseView("left")).toBe("side");
    expect(parseView("Front Left")).toBe("front-3-4");
    expect(parseView("rear_right")).toBe("rear-3-4-right");
    expect(parseView("back")).toBe("rear");
    expect(parseView("side-right")).toBe("side-right");
    expect(parseView("Top Down")).toBe("top");
    expect(parseView("Birds_Eye")).toBe("top");
    expect(parseView("bottom")).toBeNull();
    for (const view of VIEWS) expect(parseView(view)).toBe(view);
  });

  it("leaves a size above 1024 for the server to clamp, and still refuses one that is no size", () => {
    expect(imageSearchParams({ make: "a", model: "b", year: 2000, width: 1920, height: 1080 }).toString()).toBe("make=a&model=b&year=2000&w=1920&h=1080");
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, width: 2048 })).toEqual({ make: "a", model: "b", year: 2000, width: 2048 });
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, width: 0 })).toThrow(RangeError);
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, height: 12.5 })).toThrow(RangeError);
  });

  it("sends a hex paint bare in the query and as written in JSON", () => {
    expect(imageSearchParams({ make: "a", model: "b", year: 2000, color: "#1A2B3C" }).toString()).toBe("make=a&model=b&year=2000&color=1a2b3c");
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, color: "#1a2b3c" })).toEqual({ make: "a", model: "b", year: 2000, color: "#1a2b3c" });
    expect(imageRequestBody({ make: "a", model: "b", year: 2000, color: "1a2b3c" })).toEqual({ make: "a", model: "b", year: 2000, color: "1a2b3c" });
    expect(imageSearchParams({ make: "a", model: "b", year: 2000, color: "navy" }).get("color")).toBe("navy");
    expect(() => imageSearchParams({ make: "a", model: "b", year: 2000, color: "navyish" })).toThrow(/Invalid color/);
  });

  it("accepts a vehicle id in place of make, model and year", () => {
    expect(imageSearchParams({ vehicle: "veh_395yw8tn73ff8", view: "side" }).toString()).toBe("vehicle=veh_395yw8tn73ff8&view=side");
    expect(imageRequestBody({ vehicle: " veh_395yw8tn73ff8 ", size: "thumb" })).toEqual({ vehicle: "veh_395yw8tn73ff8", width: 256 });
    expect(vehicleRequestBody({ make: " Audi ", model: "A4", year: "2020" })).toEqual({ make: "Audi", model: "A4", year: 2020 });
    // Neither: a usage error before any network call. Both: sent as given; the server answers 400.
    expect(() => imageSearchParams({} as never)).toThrow(/make is required/);
    expect(() => imageSearchParams({ make: "a", model: "b" } as never)).toThrow(/year is required/);
    expect(() => imageSearchParams({ vehicle: "" } as never)).toThrow(/vehicle must be a vehicle id/);
    expect(imageSearchParams({ vehicle: "veh_395yw8tn73ff8", make: "a", model: "b", year: 2000 } as never).toString()).toBe("vehicle=veh_395yw8tn73ff8&make=a&model=b&year=2000");
  });
});
