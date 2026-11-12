import { afterEach, describe, expect, it, vi } from "vitest";
import { aliases, connect, dataPath, hints, lookup, parseDatasets, shareLink, sharePayload } from "./client.js";

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
  it("rejects two datasets with one alias", () =>
    expect(() => parseDatasets("alice/e_stat bob/e_stat")).toThrow("share an alias"));
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
    expect(fetch).toHaveBeenCalledWith("https://api/v1/datasets/queria/e_stat", undefined);
  });
  it("sends the token as Bearer", async () => {
    const fetch = vi.fn(async () => Response.json({ qualified_name: "x/y", catalog_url: "u" }));
    vi.stubGlobal("fetch", fetch);
    await lookup("https://api", "x/y", "qd_t");
    expect(fetch).toHaveBeenCalledWith("https://api/v1/datasets/x/y", { headers: { Authorization: "Bearer qd_t" } });
  });
  it("rejects a response without a catalog URL", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ dataset: { qualified_name: "x/y" } }));
    await expect(lookup("https://api", "x/y")).rejects.toThrow("no catalog_url");
  });
  it("reports a missing dataset", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(lookup("https://api", "x/y")).rejects.toThrow("x/y was not found");
  });
});

describe("sources", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("asks a token function for each lookup", async () => {
    const fetch = vi.fn(async (url: string) => Response.json({ qualified_name: url.split("/v1/datasets/")[1], catalog_url: "u" }));
    vi.stubGlobal("fetch", fetch);
    const token = vi.fn(async () => "qd_fresh");
    await connect({ datasets: ["x/a", "x/b"], apiUrl: "https://api", token }).sources();
    expect(token).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith("https://api/v1/datasets/x/a", { headers: { Authorization: "Bearer qd_fresh" } });
  });
  it("returns every declared dataset without SQL, and only the referenced ones with SQL", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json({ qualified_name: url.split("/v1/datasets/")[1], catalog_url: "u" }),
    );
    const conn = connect({ datasets: ["queria/e_stat", "queria/jma"], apiUrl: "https://api" });
    expect((await conn.sources()).map((d) => d.qualified_name)).toEqual(["queria/e_stat", "queria/jma"]);
    expect((await conn.sources("SELECT * FROM jma.main.t")).map((d) => d.qualified_name)).toEqual(["queria/jma"]);
  });
});

describe("hints", () => {
  const e_stat = { qualified_name: "queria/e_stat", page_url: "https://queria.io/datasets/queria/e_stat", catalog_url: "u" };
  it("points to the dataset pages when a table is missing", () => {
    expect(hints("Catalog Error: Table with name x does not exist!", [e_stat], [])).toEqual([
      "Tables of queria/e_stat: https://queria.io/datasets/queria/e_stat",
    ]);
  });
  it("asks to declare names that look like datasets", () => {
    expect(hints("Binder Error: x", [], ["jma"])).toEqual(["If jma is a dataset, declare it in connect({ datasets })"]);
  });
  it("names the host of a file DuckDB could not load", () => {
    expect(hints("IO Error: Failed to load 'https://data.queria.io/x.parquet'", [], [])).toEqual([
      "Could not reach https://data.queria.io. If the page has a Content Security Policy, allow https://data.queria.io in connect-src",
    ]);
  });
  it("adds nothing to other errors", () => expect(hints("Parser Error: syntax error", [e_stat], [])).toEqual([]));
});

const inflate = async (hash: string): Promise<unknown> => {
  const bytes = Uint8Array.from(atob(hash.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
};

describe("shareLink", () => {
  const datasets = [{ alias: "e_stat", qualifiedName: "queria/e_stat" }];
  it("opens the SQL and its datasets on queria.io/s", async () => {
    const url = new URL(await shareLink(sharePayload("SELECT 1 FROM e_stat.a.b", datasets)));
    expect(url.origin + url.pathname).toBe("https://queria.io/s");
    expect(await inflate(url.hash.slice(1))).toEqual({ cells: [{ type: "table", sql: "SELECT 1 FROM e_stat.a.b" }], datasets });
  });
  it("draws a chart from a view of the SQL", () =>
    expect(sharePayload("SELECT 1", [], { mark: "bar" })).toEqual({
      cells: [{ type: "plot", chart: { mark: "bar", data: { name: "result" } } }],
      views: [{ name: "result", sql: "SELECT 1" }],
      datasets: [],
    }));
});
