import { describe, expect, it } from "vitest";
import { datasetsIn, lit } from "./sql.js";

describe("datasetsIn", () => {
  it("finds datasets of three-part names", () => {
    expect(datasetsIn("SELECT * FROM e_stat.census.population p JOIN lg_code.main.cities c USING (code)")).toEqual([
      "e_stat",
      "lg_code",
    ]);
  });
  it("ignores names inside string literals and two-part names", () => {
    expect(datasetsIn("SELECT 'a.b.c' AS s, t.x FROM mlit.main.stations t")).toEqual(["mlit"]);
  });
  it("ignores comments and quoted identifiers", () => {
    expect(datasetsIn('SELECT x AS "a.b.c" -- d.e.f\nFROM /* g.h.i */ mlit.main.stations')).toEqual(["mlit"]);
  });
});

describe("lit", () => {
  it("escapes quotes", () => expect(lit("O'Hare")).toBe("'O''Hare'"));
});
