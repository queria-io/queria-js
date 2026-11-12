import { afterEach, describe, expect, it, vi } from "vitest";
import { aliases, dataPath, lookup, parseDatasets } from "./client.js";

describe("aliases", () => {
  it("uses the last part of each name as the alias", () => {
    expect([...aliases(["queria/e_stat", "queria/jma"])]).toEqual([
      ["e_stat", "queria/e_stat"],
      ["jma", "queria/jma"],
    ]);
  });
  it("takes explicit aliases", () => {
    expect([...aliases({ a: "alice/e_stat", b: "bob/e_stat" })]).toEqual([
      ["a", "alice/e_stat"],
      ["b", "bob/e_stat"],
    ]);
  });
  it("rejects short names", () => expect(() => aliases(["e_stat"])).toThrow("fully qualified"));
  it("rejects two datasets with one alias", () => expect(() => aliases(["alice/e_stat", "bob/e_stat"])).toThrow("share an alias"));
});

describe("parseDatasets", () => {
  it("reads names and alias=name pairs", () => {
    expect(parseDatasets(" queria/e_stat, a=alice/x ")).toEqual({ e_stat: "queria/e_stat", a: "alice/x" });
  });
});

describe("dataPath", () => {
  it("drops the version and points next to the catalog", () => {
    expect(dataPath("https://data.queria.io/d/k/ducklake.duckdb?v=1")).toBe("https://data.queria.io/d/k/ducklake.duckdb.files/");
  });
});

describe("lookup", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads the row by qualified name and ignores unknown fields", async () => {
    const fetch = vi.fn(async () => Response.json({ qualified_name: "queria/e_stat", catalog_url: "u", extra: 1 }));
    vi.stubGlobal("fetch", fetch);
    expect((await lookup("https://api", "queria/e_stat")).catalog_url).toBe("u");
    expect(fetch).toHaveBeenCalledWith("https://api/v1/datasets/queria/e_stat");
  });
  it("reports a missing dataset", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(lookup("https://api", "x/y")).rejects.toThrow("x/y was not found");
  });
});
