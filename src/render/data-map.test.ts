import { describe, expect, it } from "vitest";
import { areaCode, areaRows, colorsOf, pointFeatures } from "./data-map.js";

describe("areaCode", () => {
  it("restores leading zeros and drops the check digit", () => {
    expect(areaCode("prefecture", 1)).toBe("01");
    expect(areaCode("city", 13101)).toBe("13101");
    expect(areaCode("city", "131016")).toBe("13101");
    expect(areaCode("city", 1101)).toBe("01101");
    expect(areaCode("small_area", 1101000101)).toBe("01101000101");
    expect(areaCode("city", null)).toBeNull();
  });
});

describe("colorsOf", () => {
  it("runs numbers from light to dark", () => {
    expect(colorsOf([{ v: 0 }, { v: 10 }], "v")).toEqual(["#dbeafe", "#1d4ed8"]);
  });
  it("gives each category its own color", () => {
    const [a, b, c] = colorsOf([{ v: "x" }, { v: "y" }, { v: "x" }], "v");
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });
  it("uses one color without a column", () => expect(new Set(colorsOf([{}, {}], undefined)).size).toBe(1));
});

describe("pointFeatures", () => {
  it("leaves out rows without a position", () => {
    const data = pointFeatures([{ x: 139.7, y: 35.6, n: "a" }, { x: null, y: 35 }, { x: "", y: 35 }], { lng: "x", lat: "y", label: "n" });
    expect(data).toMatchObject({ features: [{ geometry: { coordinates: [139.7, 35.6] }, properties: { hover: "a" } }] });
  });
});

describe("areaRows", () => {
  it("keys rows by the tile code, first row wins", () => {
    const areas = areaRows([{ c: 13101, p: 1 }, { c: "131016", p: 2 }], { area: "city", code: "c", color: "p" });
    expect([...areas.keys()]).toEqual(["13101"]);
    expect(areas.get("13101")?.hover).toBe("p: 1");
  });
});
