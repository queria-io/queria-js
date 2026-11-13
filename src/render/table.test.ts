import { describe, expect, it } from "vitest";
import { cellText, numericColumns } from "./table.js";

describe("cellText", () => {
  it("groups digits, writes objects as JSON and NULL as empty", () => {
    expect(cellText(1234567)).toBe((1234567).toLocaleString());
    expect(cellText({ a: [1] })).toBe('{"a":[1]}');
    expect(cellText(2020)).toBe("2020");
    expect(cellText(null)).toBe("");
    expect(cellText("x")).toBe("x");
  });
});

describe("numericColumns", () => {
  it("keeps the columns whose values are all numbers or NULL", () => {
    const rows = [{ a: 1, b: "x", c: null }, { a: null, b: 2, c: 3 }];
    expect(numericColumns(rows, ["a", "b", "c"])).toEqual(new Set(["a", "c"]));
  });
});
