import { describe, expect, it } from "vitest";
import { cellText } from "./table.js";

describe("cellText", () => {
  it("groups digits, writes objects as JSON and NULL as empty", () => {
    expect(cellText(1234567)).toBe((1234567).toLocaleString());
    expect(cellText({ a: [1] })).toBe('{"a":[1]}');
    expect(cellText(2020)).toBe("2020");
    expect(cellText(null)).toBe("");
    expect(cellText("x")).toBe("x");
  });
});
