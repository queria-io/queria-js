import { describe, expect, it } from "vitest";
import { areaCode, areaRows, boundsOf, colorScale, geometriesOf, geometryFeatures, pointFeatures } from "./data-map.js";

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

describe("colorScale", () => {
  it("runs numbers from light to dark", () => {
    expect(colorScale([{ v: 0 }, { v: 10 }], "v")).toEqual({ colors: ["#d9ccf0", "#542e8c"], legend: { column: "v", min: 0, max: 10 } });
  });
  it("gives each category its own color, and lists the first seven in the legend", () => {
    const { colors, legend } = colorScale([{ v: "x" }, { v: "y" }, { v: "x" }], "v");
    expect(colors[0]).toBe(colors[2]);
    expect(colors[0]).not.toBe(colors[1]);
    expect(legend).toEqual({ column: "v", items: [{ label: "x", color: colors[0] }, { label: "y", color: colors[1] }], more: 0 });
    expect(colorScale(Array.from({ length: 12 }, (_, v) => ({ v: `c${v}` })), "v").legend).toMatchObject({ more: 5 });
  });
  it("uses one color without a column", () => {
    const { colors, legend } = colorScale([{}, {}], undefined);
    expect(new Set(colors).size).toBe(1);
    expect(legend).toBeNull();
  });
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

describe("geometriesOf", () => {
  it("reads text and objects, and splits collections", () => {
    const point = { type: "Point", coordinates: [139.7, 35.6] };
    expect(geometriesOf(JSON.stringify(point))).toEqual([point]);
    expect(geometriesOf({ type: "GeometryCollection", geometries: [point, point] })).toEqual([point, point]);
    expect(geometriesOf("not json")).toEqual([]);
    expect(geometriesOf(null)).toEqual([]);
  });
});

describe("geometryFeatures", () => {
  it("makes a feature per geometry with the row's color and hover", () => {
    const line = { type: "LineString", coordinates: [[139, 35], [140, 36]] };
    const data = geometryFeatures([{ g: JSON.stringify(line), n: "a" }, { g: null }], { geometry: "g", label: "n" });
    expect(data).toMatchObject({ features: [{ geometry: line, properties: { hover: "a", row: 0 } }] });
  });
});

describe("boundsOf", () => {
  it("spans the geometries", () => {
    const g = { type: "Polygon", coordinates: [[[139, 35], [141, 35], [140, 37], [139, 35]]] };
    expect(boundsOf({ geometry: "g" }, [{ g }], [], null)).toEqual([139, 35, 141, 37]);
  });
  it("spans the areas from the index", () => {
    expect(boundsOf({ area: "small_area", code: "c" }, [], ["14101000101", "14152000101"], { "14101": [139, 35, 140, 36], "14152": [139.5, 35.2, 140.5, 35.4] })).toEqual([139, 35, 140.5, 36]);
  });
});
