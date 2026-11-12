import { describe, expect, it } from "vitest";
import { fontOf, toneOf, withData } from "./chart.js";

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
});

describe("fontOf", () => {
  it("keeps the page's font but not the default serif", () => {
    expect(fontOf("Geist, sans-serif")).toBe("Geist, sans-serif");
    expect(fontOf('"Times New Roman"')).toBeUndefined();
    expect(fontOf("")).toBeUndefined();
  });
});
