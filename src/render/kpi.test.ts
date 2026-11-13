import { describe, expect, it } from "vitest";
import { changeRate, kpiNumber, kpiValues } from "./kpi.js";

describe("kpiValues", () => {
  const rows = [
    { year: 2019, pop: 100 },
    { year: 2020, pop: 110, prev: 90 },
  ];
  it("compares the last row with the row before it", () => {
    expect(kpiValues(rows, { value: "pop" })).toEqual({ current: 110, previous: 100 });
  });
  it("compares with a column of the last row", () => {
    expect(kpiValues(rows, { value: "pop", compare: "prev" })).toEqual({ current: 110, previous: 90 });
  });
  it("leaves out what is missing or not a number", () => {
    expect(kpiValues([{ pop: "x" }], { value: "pop" })).toEqual({ current: undefined, previous: undefined });
    expect(kpiValues([{ pop: 5n }], { value: "pop" })).toEqual({ current: 5, previous: undefined });
  });
});

describe("kpiNumber", () => {
  it("writes 万 and 億 from 10,000 on Japanese pages", () => {
    expect(kpiNumber(1234567, "ja")).toBe("123.5万");
    expect(kpiNumber(123456789, "ja")).toBe("1.235億");
    expect(kpiNumber(1234, "ja")).toBe("1,234");
    expect(kpiNumber(1234567, "ja", false)).toBe("1,234,567");
    expect(kpiNumber(1234567, "en")).toBe("1.235M");
  });
});

describe("changeRate", () => {
  it("writes the rate with its sign", () => {
    expect(changeRate(110, 100)).toBe("+10.0%");
    expect(changeRate(90, 100)).toBe("−10.0%");
    expect(changeRate(-90, -100)).toBe("+10.0%");
    expect(changeRate(1, 0)).toBeUndefined();
  });
});
