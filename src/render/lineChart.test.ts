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
  it("sorts points by x", () => {
    const rows = [
      { year: 2010, v: 2 },
      { year: 2000, v: 1 },
    ];
    expect(toSeries(rows, { x: "year", y: "v" })[0].points).toEqual([
      [2000, 1],
      [2010, 2],
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
  it("keeps negative values inside the chart", () => {
    const svg = lineChartSvg([{ label: "a", points: [[2000, -10], [2001, 10]] }], { width: 100, height: 100 });
    const cys = [...svg.matchAll(/cy="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(cys.every((v) => v >= 8 && v <= 82)).toBe(true);
  });
});
