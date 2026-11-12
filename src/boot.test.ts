import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { authPatch, isSpatialMissing, needsSpatial } from "./boot.js";

type Listener = (event: { data: unknown; stopImmediatePropagation: () => void }) => void;

/** Run the patch the way the worker does: in its own globals, with only message events and XHR. */
const runPatch = () => {
  const listeners: Listener[] = [];
  class FakeXHR {
    headers: Record<string, string> = {};
    open(_method: string, _url: string) {}
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
  }
  runInNewContext(authPatch, { self: { addEventListener: (_: string, fn: Listener) => listeners.push(fn) }, XMLHttpRequest: FakeXHR });
  const post = (data: unknown): boolean => {
    let stopped = false;
    listeners.forEach((fn) => fn({ data, stopImmediatePropagation: () => (stopped = true) }));
    return stopped;
  };
  const open = (url: string): Record<string, string> => {
    const xhr = new FakeXHR();
    xhr.open("GET", url);
    return xhr.headers;
  };
  return { post, open };
};

describe("authPatch", () => {
  it("sends nothing before it gets a token", () => {
    expect(runPatch().open("https://data.queria.io/x")).toEqual({});
  });
  it("sends the token only to the given origins", () => {
    const { post, open } = runPatch();
    post({ queriaAuth: { token: "qd_t", origins: ["https://data.queria.io"] } });
    expect(open("https://data.queria.io/d/ducklake.duckdb")).toEqual({ Authorization: "Bearer qd_t" });
    expect(open("https://data.queria.io.example.com/x")).toEqual({});
    expect(open("https://extensions.duckdb.org/x.wasm")).toEqual({});
  });
  it("keeps its messages from DuckDB and stops on a null token", () => {
    const { post, open } = runPatch();
    expect(post({ queriaAuth: { token: "qd_t", origins: ["https://data.queria.io"] } })).toBe(true);
    expect(post({ type: "duckdb" })).toBe(false);
    post({ queriaAuth: { token: null, origins: [] } });
    expect(open("https://data.queria.io/x")).toEqual({});
  });
});

describe("spatial", () => {
  it("finds ST_ calls", () => {
    expect(needsSpatial("select st_area(geom) from t")).toBe(true);
    expect(needsSpatial("select first_name from t")).toBe(false);
  });
  it("recognizes the missing-extension errors", () => {
    expect(isSpatialMissing("Function st_point is not in the catalog, but it exists in the spatial extension")).toBe(true);
    expect(isSpatialMissing("Type with name GEOMETRY does not exist")).toBe(true);
    expect(isSpatialMissing("Scalar Function with name st_area does not exist!")).toBe(true);
    expect(isSpatialMissing("Table t does not exist")).toBe(false);
    expect(isSpatialMissing("Table with name st_stations does not exist!")).toBe(false);
    expect(isSpatialMissing("Referenced column geometry does not exist")).toBe(false);
  });
});
