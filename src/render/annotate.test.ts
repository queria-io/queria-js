import { describe, expect, it } from "vitest";
import { withAnnotations } from "./annotate.js";

const ink = { text: "T", line: "L" };
const rows = [
  { year: 2019, v: 1, area: "a" },
  { year: 2020, v: 2, area: "a" },
  { year: 2020, v: 3, area: "b" },
];
const line = { mark: "line", encoding: { x: { field: "year", type: "ordinal" }, y: { field: "v", type: "quantitative", aggregate: "count" }, color: { field: "area" } } };

describe("withAnnotations", () => {
  it("turns a single view into layers with an arrow and a note at the row", () => {
    const { spec, added } = withAnnotations({ ...line, title: "t" }, rows, [{ at: "2020", text: "here" }], ink);
    expect(added).toBe(1);
    expect(spec).toMatchObject({ title: "t", layer: [line, { mark: { type: "rule" } }, { mark: { type: "point" } }, { mark: { type: "text", text: "here", align: "left", baseline: "bottom" } }] });
    // the first matching row, by its own values; count is dropped so the value stays the row's
    expect(spec).toHaveProperty("layer.3.data.values", [{ year: 2020, v: 2, area: "a" }]);
    expect(spec).toHaveProperty("layer.3.encoding", { x: { field: "year", type: "ordinal" }, y: { field: "v", type: "quantitative" }, color: { value: "T" } });
  });
  it("matches every value of at, and adds to the layers of a layered view", () => {
    const spec = { layer: [{ mark: "line" }], encoding: line.encoding };
    const out = withAnnotations(spec, rows, [{ at: ["2020", "b"], text: "b", dx: -10, dy: 0 }], ink).spec;
    expect(out).toMatchObject({ encoding: line.encoding, layer: [{ mark: "line" }, {}, {}, { data: { values: [{ v: 3 }] }, mark: { align: "right", baseline: "middle" } }] });
  });
  it("leaves the spec as it is when no row is found or the chart has several views", () => {
    expect(withAnnotations(line, rows, [{ at: "2030", text: "x" }], ink)).toEqual({ spec: line, added: 0 });
    const concat = { hconcat: [line] };
    expect(withAnnotations(concat, rows, [{ at: "2020", text: "x" }], ink).spec).toBe(concat);
  });
});
