import { describe, expect, it } from "vitest";
import { cellText, isCodeColumn, isLink, numericColumns } from "./table.js";

describe("cellText", () => {
  it("groups digits, writes objects as JSON and NULL as empty", () => {
    expect(cellText(1234567)).toBe((1234567).toLocaleString());
    expect(cellText({ a: [1], b: 2n })).toBe('{"a":[1],"b":"2"}');
    expect(cellText(2020)).toBe("2020");
    expect(cellText(null)).toBe("");
    expect(cellText("x")).toBe("x");
  });

  it("keeps every decimal digit", () => {
    expect(cellText(0.0004)).toBe("0.0004");
    expect(cellText(3.14159)).toBe("3.14159");
    expect(cellText(1 / 3)).toBe("0.3333333333333333");
    expect(cellText(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(cellText(1234567.891)).toBe((1234567).toLocaleString() + ".891");
    expect(cellText(-0.5)).toBe("-0.5");
  });

  it("keeps the exponent of very small and very large numbers", () => {
    expect(cellText(1e-7)).toBe("1e-7");
    expect(cellText(1.5e21)).toBe("1.5e+21");
    expect(cellText(Number.NaN)).toBe("NaN");
  });

  it("writes bigints with every digit", () => {
    expect(cellText(12345678901234567890n)).toBe((12345678901234567890n).toLocaleString());
    expect(cellText(2020n)).toBe("2020");
  });

  it("does not group codes", () => {
    expect(cellText(202401, false)).toBe("202401");
    expect(cellText(13101n, false)).toBe("13101");
  });
});

describe("isCodeColumn", () => {
  it("reads codes, IDs and dates from the name", () => {
    const codes = ["lg_code", "survey_year", "cityCode", "yyyymm", "id", "年月", "市区町村コード", "年", "年度"];
    const quantities = ["population", "count", "code_count", "2020年", "人口", "average"];
    expect(codes.filter(isCodeColumn)).toEqual(codes);
    expect(quantities.filter(isCodeColumn)).toEqual([]);
  });
});

describe("numericColumns", () => {
  it("keeps the columns whose values are all numbers, bigints or NULL", () => {
    const rows = [{ a: 1, b: "x", c: null, d: 1n }, { a: null, b: 2, c: 3, d: 2 }];
    expect(numericColumns(rows, ["a", "b", "c", "d"])).toEqual(new Set(["a", "c", "d"]));
  });
});

describe("isLink", () => {
  it("takes http and https addresses without spaces", () => {
    const links = ["https://gikai.team-mir.ai/bills/1", "http://example.com", "HTTPS://EXAMPLE.COM/a?b=1"];
    const others = ["gikai.team-mir.ai", "https://a b", "ftp://example.com", "see https://example.com", 1, null];
    expect(links.filter(isLink)).toEqual(links);
    expect(others.filter(isLink)).toEqual([]);
  });
});
