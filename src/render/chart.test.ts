import { describe, expect, it } from "vitest";
import { fontOf, toneOf, withData, withHighlight } from "./chart.js";

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

describe("withHighlight", () => {
  const rows = [{ name: "a", v: 1 }, { name: "b", v: 2 }];
  it("colors the marks of the value on an axis", () => {
    const spec = withHighlight({ mark: "bar", encoding: { y: { field: "name" }, x: { field: "v" } } }, rows, ["a"], "P", "G");
    expect(spec).toMatchObject({ encoding: { color: { condition: { test: `indexof(["a"], '' + datum["name"]) >= 0`, value: "P" }, value: "G" } } });
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
});
