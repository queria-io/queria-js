import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { datasetsIn, lit } from "./sql.js";

/** A license of a dataset, as returned by the Queria API. */
export type License = { id?: string; title?: string; url?: string };

/** The part of a dataset row from the Queria API that the package uses. */
export type Dataset = {
  qualified_name: string;
  title?: string;
  page_url?: string;
  licenses?: License[];
  catalog_url: string;
  versioned_catalog_url?: string;
};

/** Datasets to read, by fully qualified name. An array uses each name's last part as the SQL alias. */
export type Declared = readonly string[] | Readonly<Record<string, string>>;

export type ConnectOptions = {
  datasets: Declared;
  /** Base URL of the Queria API. */
  apiUrl?: string;
  /** Base URL of the DuckDB WASM bundles. */
  wasmUrl?: string;
};

export type Connection = {
  /** Run SQL and return rows as plain objects. Datasets the SQL references are attached on first use. */
  sql: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
  /** The declared datasets the SQL references, for showing their sources and licenses. */
  sources: (sql: string) => Promise<Dataset[]>;
};

const API = "https://api.queria.io";
// Must match the @duckdb/duckdb-wasm version in package.json "dependencies".
const WASM = "https://assets.queria.io/duckdb-wasm/1.33.1-dev57.0";

const ALIAS = /^[a-z_][a-z0-9_]*$/;
const QUALIFIED = /^[a-z0-9_-]+\/[a-z_][a-z0-9_]*$/i;

/** Map each SQL alias to a fully qualified name, rejecting names the package cannot use. */
export const aliases = (declared: Declared): Map<string, string> => {
  const pairs: [string, string][] = Array.isArray(declared)
    ? declared.map((q: string) => [q.split("/")[1] ?? "", q])
    : Object.entries(declared);
  pairs.forEach(([alias, q]) => {
    if (!QUALIFIED.test(q)) throw new Error(`"${q}" is not a fully qualified dataset name such as "queria/e_stat"`);
    if (!ALIAS.test(alias)) throw new Error(`"${alias}" cannot be used as an SQL alias`);
  });
  const map = new Map(pairs);
  if (map.size !== pairs.length) throw new Error("Two datasets share an alias. Declare them as { alias: name }");
  return map;
};

const boot = async (wasm: string): Promise<AsyncDuckDB> => {
  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: `${wasm}/duckdb-mvp.wasm`, mainWorker: `${wasm}/duckdb-browser-mvp.worker.js` },
    eh: { mainModule: `${wasm}/duckdb-eh.wasm`, mainWorker: `${wasm}/duckdb-browser-eh.worker.js` },
  });
  // The worker lives on another origin, so start it from a blob URL.
  const res = await fetch(bundle.mainWorker ?? "");
  if (!res.ok) throw new Error(`${bundle.mainWorker}: ${res.status}`);
  const scriptUrl = URL.createObjectURL(await res.blob());
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(scriptUrl));
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    // Read Parquet by range instead of downloading whole files. Arrow returns DECIMAL as an unscaled
    // integer, so let DuckDB convert it to DOUBLE.
    await db.open({ filesystem: { forceFullHTTPReads: false }, query: { castDecimalToDouble: true } });
    const conn = await db.connect();
    await conn.query("INSTALL ducklake; LOAD ducklake").finally(() => conn.close());
  } catch (e) {
    await db.terminate();
    throw e;
  } finally {
    URL.revokeObjectURL(scriptUrl);
  }
  return db;
};

/** Look up a dataset row. The API returns the catalog URL; the package never builds it. */
export const lookup = async (api: string, qualified: string): Promise<Dataset> => {
  const res = await fetch(`${api}/v1/datasets/${qualified}`);
  if (res.status === 404) throw new Error(`Dataset ${qualified} was not found`);
  if (!res.ok) throw new Error(`${api}/v1/datasets/${qualified}: ${res.status}`);
  return (await res.json()) as Dataset;
};

/** Parquet files sit next to the catalog: .../ducklake.duckdb → .../ducklake.duckdb.files/ */
export const dataPath = (catalogUrl: string): string => `${catalogUrl.split("?")[0]}.files/`;


/**
 * Attach one dataset. The catalog is fetched in a single GET: letting DuckDB read it by range
 * costs hundreds of 16 KiB round trips for large catalogs. Data files are still read by range.
 */
const attach = async (db: AsyncDuckDB, alias: string, d: Dataset): Promise<void> => {
  const url = d.versioned_catalog_url ?? d.catalog_url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const file = `${d.qualified_name.replace("/", "__")}.duckdb`;
  await db.registerFileBuffer(file, new Uint8Array(await res.arrayBuffer()));
  const conn = await db.connect();
  try {
    await conn.query(
      `ATTACH ${lit(`ducklake:${file}`)} AS ${alias} (READ_ONLY, DATA_PATH ${lit(dataPath(d.catalog_url))}, OVERRIDE_DATA_PATH true)`,
    );
  } finally {
    await conn.close();
  }
};

/** Convert Arrow values to plain JS: lists to arrays, structs to objects, BIGINT and HUGEINT to number. */
export const plain = (v: unknown): unknown => {
  if (typeof v === "bigint") return Number(v);
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(plain);
  // 128-bit integers come as Arrow big numbers (typed arrays); BLOBs stay Uint8Array.
  if (ArrayBuffer.isView(v)) return Symbol.for("isArrowBigNum") in v ? Number(String(v)) : v;
  if ("toJSON" in v && typeof v.toJSON === "function") return plain(v.toJSON());
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
};

/** One DuckDB per WASM URL, shared by every connection on the page. Aliases are global within it. */
type Engine = { db: () => Promise<AsyncDuckDB>; attached: Map<string, { qualified: string; done: Promise<void> }> };
const engines = new Map<string, Engine>();

const engine = (wasm: string): Engine => {
  const found = engines.get(wasm);
  if (found) return found;
  let db: Promise<AsyncDuckDB> | null = null;
  const e: Engine = {
    db: () =>
      (db ??= boot(wasm).catch((err: unknown) => {
        db = null;
        e.attached.clear();
        throw err;
      })),
    attached: new Map(),
  };
  engines.set(wasm, e);
  return e;
};

/** Stop every DuckDB the package started. A later query starts it again. */
export const closeAll = async (): Promise<void> => {
  const all = [...engines.values()];
  engines.clear();
  // A failed start was already reported to the query that started it.
  await Promise.all(all.map((e) => e.db().then((d) => d.terminate(), () => undefined)));
};

/**
 * Connect to Queria datasets. Declare every dataset the SQL reads by its fully qualified name;
 * the SQL refers to it by alias, such as e_stat.census.population. Short names are never resolved.
 */
export const connect = ({ datasets, apiUrl = API, wasmUrl = WASM }: ConnectOptions): Connection => {
  const declared = aliases(datasets);
  const rows = new Map<string, Promise<Dataset>>();
  const row = (qualified: string): Promise<Dataset> => {
    const p =
      rows.get(qualified) ??
      lookup(apiUrl, qualified).catch((e: unknown) => {
        rows.delete(qualified);
        throw e;
      });
    rows.set(qualified, p);
    return p;
  };

  /** Declared aliases the SQL references. Other three-part names are left to DuckDB (alias.column.field). */
  const used = (sql: string): string[] => datasetsIn(sql).filter((a) => declared.has(a));

  const ensure = async (alias: string): Promise<void> => {
    const qualified = declared.get(alias) ?? "";
    const e = engine(wasmUrl);
    const db = await e.db();
    const prev = e.attached.get(alias);
    if (prev && prev.qualified !== qualified)
      throw new Error(`Alias ${alias} is already used for ${prev.qualified} on this page. Declare ${qualified} with another alias`);
    const done =
      prev?.done ??
      row(qualified)
        .then((d) => attach(db, alias, d))
        .catch((err: unknown) => {
          e.attached.delete(alias);
          throw err;
        });
    e.attached.set(alias, { qualified, done });
    await done;
  };

  const sql = async <T,>(query: string): Promise<T[]> => {
    await Promise.all(used(query).map(ensure));
    const conn = await (await engine(wasmUrl).db()).connect();
    try {
      return (await conn.query(query)).toArray().map((r) => plain(r) as T);
    } catch (e) {
      const undeclared = datasetsIn(query).filter((a) => !declared.has(a));
      if (undeclared.length === 0) throw e;
      throw new Error(`${String(e)}\nIf ${undeclared.join(", ")} is a dataset, declare it in connect({ datasets })`, { cause: e });
    } finally {
      await conn.close();
    }
  };

  const sources = (query: string): Promise<Dataset[]> => Promise.all(used(query).map((a) => row(declared.get(a) ?? "")));

  return { sql, sources };
};

/** Read a list of datasets from an HTML attribute: "queria/e_stat queria/jma" or "a=alice/x b=bob/x". */
export const parseDatasets = (attr: string): Declared =>
  Object.fromEntries(
    attr
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((w) => (w.includes("=") ? w.split("=", 2) : [w.split("/")[1] ?? "", w])),
  );
