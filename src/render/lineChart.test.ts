import { describe, expect, it } from "vitest";
import { lineChartSvg, toSeries } from "./lineChart.js";

describe("toSeries", () => {
  it("splits rows by a column and skips nulls", () => {
    const rows = [
      { year: 2000, v: 1, a: "x" },
      { year: 2005, v: null, a: "x" },
      { year: 2000, v: 3, a: "y" },
    ];
    expect(toSeries(rows, { x: "year", y: "v", by: "a" })).toEqual([
      { label: "x", points: [[2000, 1]] },
      { label: "y", points: [[2000, 3]] },
    ]);
  });
});

describe("lineChartSvg", () => {
  it("escapes labels", () => {
    const svg = lineChartSvg([
      { label: "<b>", points: [[2000, 1]] },
      { label: "y", points: [[2000, 2]] },
    ]);
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).not.toContain("<b>");
  });
  it("is empty without points", () => expect(lineChartSvg([])).toBe(""));
});
