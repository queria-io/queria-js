import { describe, expect, it } from "vitest";
import { plainRows } from "./client.js";

describe("plainRows", () => {
  it("divides DECIMAL by its scale and leaves other columns", () => {
    const table = {
      schema: { fields: [{ name: "v", type: { typeId: 7, scale: 1 } }, { name: "n", type: { typeId: 2 } }] },
      toArray: () => [{ v: 15n, n: 3n }, { v: null, n: 1 }],
    };
    expect(plainRows(table)).toEqual([{ v: 1.5, n: 3 }, { v: null, n: 1 }]);
  });
});
