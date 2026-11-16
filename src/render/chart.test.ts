import { describe, expect, it } from "vitest";
import { fitsPanels, fontOf, toneOf, withData, withHighlight, withinDomain, withPanelWidth, withSignedColors } from "./chart.js";

describe("withData", () => {
  it("puts rows into a spec without data", () => {
    expect(withData({ mark: "line" }, [{ x: 1 }])).toEqual({ width: "container", mark: "line", data: { values: [{ x: 1 }] } });
  });
  it("passes named rows as datasets for data: { name }", () => {
    const spec = { layer: [{ mark: "line", data: { name: "a" } }, { mark: "point", data: { name: "b" } }] };
    expect(withData(spec, { a: [{ x: 1 }], b: [{ x: 2 }] })).toMatchObject({ datasets: { a: [{ x: 1 }], b: [{ x: 2 }] } });
  });
  it("keeps the spec's own datasets", () => {
    expect(withData({ datasets: { c: [{ x: 3 }] }, mark: "line" }, { a: [{ x: 1 }] })).toMatchObject({
      datasets: { c: [{ x: 3 }], a: [{ x: 1 }] },
    });
  });
  it("copies rows and leaves width alone for composite views", () => {
    const rows = [Object.freeze({ x: 1 })];
    const out = withData({ hconcat: [] }, rows);
    expect(out).not.toHaveProperty("width");
    expect(Object.isFrozen((out.data as { values: object[] }).values[0])).toBe(false);
  });
  it("leaves the panels of a facet at the size Vega-Lite gives them", () => {
    expect(withData({ mark: "bar", encoding: { column: { field: "c" } } }, [])).not.toHaveProperty("width");
  });
});

describe("withinDomain", () => {
  const axis = { field: "v", type: "quantitative", scale: { domain: [50, 100] } };
  const clamped = { ...axis, scale: { domain: [50, 100], clamp: true } };
  it("clips the marks of a view with a domain on x or y", () => {
    expect(withinDomain({ mark: "point", encoding: { x: axis } })).toEqual({ mark: { type: "point", clip: true }, encoding: { x: axis } });
  });
  it("clamps bars to the domain instead of clipping them", () => {
    expect(withinDomain({ mark: "bar", encoding: { x: axis } })).toEqual({ mark: "bar", encoding: { x: clamped } });
  });
  it("looks at the domain of the view around a layer, and keeps labels of bars clamped to it", () => {
    const spec = { encoding: { y: axis }, layer: [{ mark: { type: "bar" } }, { mark: "text", encoding: { y: { field: "v" } } }] };
    expect(withinDomain(spec)).toMatchObject({ layer: [{ mark: { type: "bar" }, encoding: { y: clamped } }, { mark: "text" }] });
  });
  it("takes a domain written in one layer for all of them, as they share the scale", () => {
    const spec = { layer: [{ mark: "point", encoding: { y: axis } }, { mark: "rule", encoding: { y: { datum: 20 } } }] };
    expect(withinDomain(spec)).toMatchObject({ layer: [{ mark: { type: "point", clip: true } }, { mark: { type: "rule", clip: true } }] });
  });
  it("reads domainMin and domainMax as ends of the domain", () => {
    const from = { field: "v", type: "quantitative", scale: { domainMin: 50 } };
    expect(withinDomain({ mark: "bar", encoding: { y: from } })).toEqual({ mark: "bar", encoding: { y: { ...from, scale: { domainMin: 50, clamp: true } } } });
  });
  it("clamps bars only along the channel they run along", () => {
    const years = { field: "t", type: "temporal", scale: { domain: [2020, 2024] } };
    const spec = { mark: "bar", encoding: { x: years, y: { field: "v", type: "quantitative" } } };
    expect(withinDomain(spec)).toBe(spec);
  });
  it("keeps marks on a scale of categories, whose domain only orders them", () => {
    const spec = { mark: "line", encoding: { x: { field: "a", type: "nominal", scale: { domain: ["b", "a"] } }, y: { field: "v", type: "quantitative" } } };
    expect(withinDomain(spec)).toBe(spec);
  });
  it("looks into the panel of a facet", () => {
    expect(withinDomain({ facet: { field: "f" }, spec: { mark: "point", encoding: { x: axis } } })).toEqual({
      facet: { field: "f" },
      spec: { mark: { type: "point", clip: true }, encoding: { x: axis } },
    });
  });
  it("keeps the spec as it is without a domain, or when it says whether to clip and clamp", () => {
    const free = { mark: "bar", encoding: { x: { field: "v", scale: { zero: false } } } };
    const own = { mark: { type: "bar", clip: false }, encoding: { x: { ...axis, scale: { domain: [50, 100], clamp: false } } } };
    expect(withinDomain(free)).toBe(free);
    expect(withinDomain(own)).toBe(own);
  });
});

describe("withPanelWidth", () => {
  it("gives the panels of a facet a width to start from, unless the spec sets one", () => {
    const panel = { mark: "bar", encoding: { x: { field: "a" } } };
    expect(withPanelWidth({ ...panel, encoding: { ...panel.encoding, column: { field: "c" } } })).toMatchObject({ width: 100 });
    expect(withPanelWidth({ facet: { field: "c" }, spec: panel })).toMatchObject({ spec: { width: 100 } });
    expect(withPanelWidth({ facet: { field: "c" }, spec: { ...panel, width: 50 } })).toMatchObject({ spec: { width: 50 } });
  });
});

describe("fitsPanels", () => {
  it("is true for a facet whose panel has no width", () => {
    expect(fitsPanels({ mark: "bar", encoding: { row: { field: "c" } } })).toBe(true);
    expect(fitsPanels({ facet: { row: { field: "c" } }, spec: { mark: "bar" } })).toBe(true);
    expect(fitsPanels({ facet: { row: { field: "c" } }, spec: { mark: "bar", width: 50 } })).toBe(false);
    expect(fitsPanels({ hconcat: [] })).toBe(false);
    expect(fitsPanels({ mark: "bar" })).toBe(false);
    // Vega-Lite drops row, column and facet from a layer's shared encoding
    expect(fitsPanels({ layer: [{ mark: "bar" }], encoding: { column: { field: "c" } } })).toBe(false);
  });
});

describe("toneOf", () => {
  it("is dark for light text", () => {
    expect(toneOf("rgb(250, 250, 250)")).toBe("dark");
    expect(toneOf("rgb(10, 10, 10)")).toBe("light");
    expect(toneOf("")).toBe("light");
  });

  it("reads colors the page wrote in other spaces", () => {
    expect(toneOf("oklch(0.985 0 0)")).toBe("dark");
    expect(toneOf("oklch(0.145 0 0)")).toBe("light");
    expect(toneOf("color(srgb 0.98 0.98 0.98)")).toBe("dark");
    expect(toneOf("color(display-p3 0.1 0.1 0.1)")).toBe("light");
    expect(toneOf("lab(98 0 0)")).toBe("dark");
  });
});

describe("fontOf", () => {
  it("keeps the page's font but not the default serif", () => {
    expect(fontOf("Geist, sans-serif")).toBe("Geist, sans-serif");
    expect(fontOf('"Times New Roman"')).toBeUndefined();
    expect(fontOf("")).toBeUndefined();
    expect(fontOf("-webkit-standard")).toBeUndefined();
  });
});

describe("withSignedColors", () => {
  const heat = { mark: "rect", encoding: { color: { field: "v", type: "quantitative" } } };
  it("colors numbers below and above zero red to blue around zero", () => {
    expect(withSignedColors(heat, [{ v: -1 }, { v: 2 }])).toMatchObject({ encoding: { color: { scale: { domainMid: 0, range: "diverging" } } } });
  });
  it("leaves numbers of one sign and the author's own colors as they are", () => {
    expect(withSignedColors(heat, [{ v: 1 }, { v: 2 }])).toBe(heat);
    const own = { ...heat, encoding: { color: { ...heat.encoding.color, scale: { scheme: "blues" } } } };
    expect(withSignedColors(own, [{ v: -1 }, { v: 2 }])).toBe(own);
  });
});

describe("withHighlight", () => {
  const rows = [{ name: "a", v: 1 }, { name: "b", v: 2 }];
  it("colors the marks of the value on an axis", () => {
    const spec = withHighlight({ mark: "bar", encoding: { y: { field: "name" }, x: { field: "v" } } }, rows, ["a"], "P", "G");
    expect(spec).toMatchObject({ encoding: { color: { condition: { value: "P" }, value: "G" } } });
    expect(JSON.stringify(spec)).toContain(`indexof([\\"a\\"], '' + datum[\\"name\\"]) >= 0`);
  });
  it("tries a category axis before a number axis", () => {
    const spec = withHighlight({ mark: "bar", encoding: { y: { field: "v", type: "quantitative" }, x: { field: "n", type: "ordinal" } } }, [{ n: 2, v: 1 }, { n: 1, v: 2 }], [1], "P", "G");
    expect(JSON.stringify(spec)).toContain('datum[\\"n\\"]');
  });
  it("matches a date by its day", () => {
    const spec = withHighlight({ mark: "line", encoding: { x: { field: "d" } } }, [{ d: new Date("2020-04-01T00:00:00Z") }], ["2020-04-01"], "P", "G");
    expect(spec).toHaveProperty("encoding.color.value", "G");
  });
  it("returns the spec as it is when no value is found, so series keep their colors", () => {
    const spec = { mark: "line", encoding: { x: { field: "name" }, color: { field: "v" } } };
    expect(withHighlight(spec, rows, ["a"], "P", "G")).toBe(spec);
    expect(withHighlight({ mark: "bar", encoding: { y: { field: "name" } } }, rows, ["z"], "P", "G")).toEqual({ mark: "bar", encoding: { y: { field: "name" } } });
  });
  it("colors a series by its name, and leaves text marks alone", () => {
    const spec = withHighlight(
      { layer: [{ mark: "line", encoding: { color: { field: "name" } } }, { mark: { type: "text" }, encoding: { y: { field: "name" } } }] },
      rows,
      ["b"],
      "P",
      "G",
    );
    expect(spec).toMatchObject({ layer: [{ encoding: { color: { field: "name", scale: { domain: ["a", "b"], range: ["G", "P"] } } } }, { encoding: { y: { field: "name" } } }] });
    expect(JSON.stringify(spec)).not.toContain("condition");
  });
  it("reads each layer's own named rows", () => {
    const spec = withHighlight(
      { layer: [{ data: { name: "a" }, mark: "line", encoding: { color: { field: "name" } } }, { data: { name: "b" }, mark: "rule" }] },
      { a: [{ name: "x" }, { name: "y" }], b: [{ v: 1 }] },
      ["y"],
      "P",
      "G",
    );
    expect(spec).toHaveProperty("layer.0.encoding.color.scale", { domain: ["x", "y"], range: ["G", "P"] });
  });
  it("keeps the author's series order and leaves colors by a number alone", () => {
    const series = withHighlight({ mark: "line", encoding: { color: { field: "name", scale: { domain: ["b", "a"], scheme: "tableau10", zero: false } } } }, rows, ["a"], "P", "G");
    expect(series).toHaveProperty("encoding.color.scale", { domain: ["b", "a"], range: ["G", "P"], zero: false });
    const heat = { mark: "rect", encoding: { x: { field: "name" }, color: { field: "v", type: "quantitative" } } };
    expect(withHighlight(heat, rows, ["1"], "P", "G")).toEqual(heat);
  });
});
