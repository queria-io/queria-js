import { describe, expect, it } from "vitest";
import { areaCode, areaRows, boundsOf, colorScale, geometriesBounds, geometriesOf, geometryFeatures, geometryParts, layerKind, legendOf, pointFeatures } from "./data-map.js";
import { OTHER, SERIES } from "./palette.js";

const RAMP = ["#edf8b1", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"];

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
    expect(colorScale([{ v: 0 }, { v: 10 }], "v")).toEqual({ colors: ["#edf8b1", "#253494"], positions: [0, 1], legend: { column: "v", min: 0, max: 10, colors: RAMP } });
  });
  it("reads numbers written as text, and keeps a few non-numbers in a number column", () => {
    expect(colorScale([{ v: "1" }, { v: "3" }, { v: "-" }], "v").legend).toEqual({ column: "v", min: 1, max: 3, colors: RAMP });
  });
  it("follows the scale given", () => {
    expect(colorScale([{ v: 1 }, { v: 2 }], "v", undefined, { scale: "category" }).legend).toMatchObject({ items: [{ label: "1" }, { label: "2" }] });
    expect(colorScale([1, 2, 3].map((v) => ({ v })), "v", undefined, { scale: "log" }).legend).toMatchObject({ mid: Math.sqrt(3) });
  });
  it("gives each category its own color in order of first appearance", () => {
    const { colors, legend } = colorScale([{ v: "x" }, { v: "y" }, { v: "x" }], "v");
    expect(colors).toEqual([SERIES[0], SERIES[1], SERIES[0]]);
    expect(legend).toEqual({ column: "v", items: [{ label: "x", color: SERIES[0] }, { label: "y", color: SERIES[1] }] });
  });
  it("gathers the categories after the seventh in gray, with a value that is itself Other", () => {
    const rows = [...Array.from({ length: 9 }, (_, v) => ({ v: `c${v}` })), { v: "その他" }];
    const { colors, legend } = colorScale(rows, "v", undefined, { locale: "ja" });
    expect(colors.slice(6)).toEqual([SERIES[6], OTHER, OTHER, OTHER]);
    expect(legend && "items" in legend && legend.items.map((i) => i.label)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "その他"]);
    expect(colorScale(rows, "v", undefined, { locale: "en" }).legend).toMatchObject({ items: expect.arrayContaining([{ label: "Other", color: OTHER }]) });
  });
  it("uses a log scale when a few values are far larger, and puts the middle value in the legend", () => {
    const { colors, legend } = colorScale([1, 2, 3, 10, 100].map((v) => ({ v })), "v");
    expect(legend).toEqual({ column: "v", min: 1, max: 100, mid: 10, colors: RAMP });
    expect(colors[3]).toBe("#41b6c4");
    expect(colorScale([{ v: 1 }, { v: 5 }, { v: 9 }], "v").legend).not.toHaveProperty("mid");
  });
  it("takes the range from the placed rows only", () => {
    const { colors, legend } = colorScale([{ v: 1 }, { v: 2 }, { v: 1000 }], "v", (i) => i < 2);
    expect(legend).toEqual({ column: "v", min: 1, max: 2, colors: RAMP });
    expect(colors[1]).toBe("#253494");
  });
  it("uses one color without a column", () => {
    const { colors, legend } = colorScale([{}, {}], undefined);
    expect(new Set(colors).size).toBe(1);
    expect(legend).toBeNull();
  });
});

describe("pointFeatures", () => {
  it("leaves out rows without a position", () => {
    const data = pointFeatures([{ x: 139.7, y: 35.6, n: "a" }, { x: null, y: 35 }, { x: "", y: 35 }, { x: 35, y: 139 }], { lng: "x", lat: "y", label: "n" });
    expect(data.features).toHaveLength(1);
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

describe("areaRows with an index", () => {
  it("leaves out codes the boundary tiles do not have", () => {
    const index = { "13101": [139, 35, 140, 36] as [number, number, number, number] };
    const rows = [{ c: "13101", p: 1 }, { c: "00000", p: 999 }, { c: "13102", p: 2 }];
    expect([...areaRows(rows, { area: "city", code: "c", color: "p" }, index).keys()]).toEqual(["13101"]);
    expect(legendOf({ area: "city", code: "c", color: "p" }, rows, index)).toEqual({ column: "p", min: 1, max: 1, colors: RAMP });
  });
  it("checks the length of small area codes", () => {
    const index = { "13101": [139, 35, 140, 36] as [number, number, number, number] };
    expect(areaRows([{ c: "1310100" }], { area: "small_area", code: "c" }, index).size).toBe(0);
    expect(areaRows([{ c: "131010001" }], { area: "small_area", code: "c" }, index).size).toBe(1);
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

describe("geometriesBounds", () => {
  it("spans the geometries and is null without them", () => {
    const a = { type: "Polygon", coordinates: [[[140.1, 36.08], [140.12, 36.08], [140.11, 36.09], [140.1, 36.08]]] };
    const b = { type: "MultiPolygon", coordinates: [[[[140.09, 36.07], [140.1, 36.07], [140.1, 36.075], [140.09, 36.07]]]] };
    expect(geometriesBounds([a, b])).toEqual([140.09, 36.07, 140.12, 36.09]);
    expect(geometriesBounds([])).toBeNull();
  });
});

describe("hover", () => {
  it("shows the name, the label, the value in the locale and the popup columns", () => {
    const data = pointFeatures([{ x: 139, y: 35, n: "a", p: 1234.5, memo: "m", empty: "" }], { lng: "x", lat: "y", label: "n", color: "p", name: "店", popup: ["memo", "empty"] }, { locale: "de" });
    expect(data.features[0].properties?.hover).toBe("店\na\np: 1.234,5\nmemo: m");
  });
  it("leaves out the colored value when the cell is empty", () => {
    const data = pointFeatures([{ x: 139, y: 35, n: "a", p: null }, { x: 139, y: 35, n: "b" }], { lng: "x", lat: "y", label: "n", color: "p" });
    expect(data.features.map((f) => f.properties?.hover)).toEqual(["a", "b"]);
  });
});

describe("lines", () => {
  it("draws flows as lines, widens them by value and marks the arrowheads", () => {
    const flow = (n: number) => ({
      g: { type: "GeometryCollection", geometries: [{ type: "LineString", coordinates: [[139, 35], [140, 36]] }, { type: "Polygon", coordinates: [[[140, 36], [139.9, 36], [140, 35.9], [140, 36]]] }] },
      n,
    });
    const layer = { geometry: "g", color: "n" };
    expect(layerKind(layer, [flow(1)])).toBe("line");
    expect(geometryParts(flow(1).g).map((p) => p.head)).toEqual([false, true]);
    const props = geometryFeatures([flow(1), flow(3)], layer).features.map((f) => f.properties);
    expect(props.map((p) => p?.width)).toEqual([1, 1, 5, 5]);
    expect(props.map((p) => p?.head ?? false)).toEqual([false, true, false, true]);
    expect(props[0]?.color).toBe("#c4c4cc");
  });
});
