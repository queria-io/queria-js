import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { boot, setAuth, withSpatial } from "./boot.js";
import { datasetsIn, lit } from "./sql.js";
import { fetchFrom, loadFailureHint } from "./fetch.js";

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
  /** Base URL of the DuckDB WASM bundles. jsDelivr is used when they cannot be loaded. */
  wasmUrl?: string;
  /**
   * A data token (qd_...) for datasets that are not public, or a function that returns one. A function is
   * called before each request, so it can return a fresh token. The token is sent to the API and to the
   * hosts of the declared datasets. DuckDB is shared by the page, so use one token per page.
   */
  token?: string | (() => string | Promise<string>);
};

export type Connection = {
  /** Run SQL and return rows as plain objects. Datasets the SQL references are attached on first use. */
  sql: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
  /**
   * The declared datasets the SQL references, for showing their sources and licenses.
   * Without SQL (rows computed elsewhere), every declared dataset.
   */
  sources: (sql?: string) => Promise<Dataset[]>;
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

/** Look up a dataset row. The API returns the catalog URL; the package never builds it. */
export const lookup = async (api: string, qualified: string, token: string | null = null): Promise<Dataset> => {
  const res = await fetchFrom(`${api}/v1/datasets/${qualified}`, bearer(token));
  if (res.status === 404) throw new Error(`Dataset ${qualified} was not found`);
  if (!res.ok) throw new Error(`${api}/v1/datasets/${qualified}: ${res.status}`);
  const d = (await res.json()) as Partial<Dataset> | null;
  if (typeof d?.catalog_url !== "string" || typeof d.qualified_name !== "string")
    throw new Error(`${api}/v1/datasets/${qualified}: the response has no catalog_url or qualified_name`);
  return d as Dataset;
};

const bearer = (token: string | null): RequestInit | undefined =>
  token === null ? undefined : { headers: { Authorization: `Bearer ${token}` } };

/** Parquet files sit next to the catalog: .../ducklake.duckdb → .../ducklake.duckdb.files/ */
export const dataPath = (catalogUrl: string): string => `${catalogUrl.split("?")[0]}.files/`;

/**
 * Attach one dataset. The catalog is fetched in a single GET: letting DuckDB read it by range
 * costs hundreds of 16 KiB round trips for large catalogs. Data files are still read by range.
 */
const attach = async (db: AsyncDuckDB, alias: string, d: Dataset, token: string | null): Promise<void> => {
  const url = d.versioned_catalog_url ?? d.catalog_url;
  const res = await fetchFrom(url, bearer(token));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // One file per alias: an alias is attached once per DuckDB, while one dataset can be attached
  // under two aliases, and DuckDB refuses to attach one path twice.
  const file = `${alias}.duckdb`;
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

/**
 * What to try after an SQL error: declare a dataset the SQL seems to read, allow a host the page blocked,
 * or look up the table names on the pages of the datasets it reads.
 */
export const hints = (message: string, used: readonly Dataset[], undeclared: readonly string[]): string[] => [
  ...(undeclared.length ? [`If ${undeclared.join(", ")} is a dataset, declare it in connect({ datasets })`] : []),
  ...[loadFailureHint(message)].filter((h): h is string => h !== null),
  ...(/Catalog Error: (Table|Schema) with name/i.test(message)
    ? used.flatMap((d) => (d.page_url ? [`Tables of ${d.qualified_name}: ${d.page_url}`] : []))
    : []),
];

/** One DuckDB per WASM URL, shared by every connection on the page. Aliases are global within it. */
type Engine = {
  db: () => Promise<AsyncDuckDB>;
  /** Terminate DuckDB if it was started. Never starts it. */
  stop: () => Promise<void>;
  attached: Map<string, { qualified: string; done: Promise<void> }>;
};
const engines = new Map<string, Engine>();

const engine = (wasm: string): Engine => {
  const found = engines.get(wasm);
  if (found) return found;
  let db: Promise<AsyncDuckDB> | null = null;
  const e: Engine = {
    db: async () => {
      const p = (db ??= boot(wasm).catch((err: unknown) => {
        if (db === p) {
          db = null;
          e.attached.clear();
        }
        throw err;
      }));
      const d = await p;
      // stop() ran while DuckDB was starting; it terminates this one.
      if (db !== p) throw new Error("DuckDB was stopped");
      return d;
    },
    stop: async () => {
      const started = db;
      db = null;
      e.attached.clear();
      // A failed start was already reported to the query that started it.
      await started?.then((d) => d.terminate(), () => undefined);
    },
    attached: new Map(),
  };
  engines.set(wasm, e);
  return e;
};

/** Stop every DuckDB the package started. A later query starts it again. */
export const closeAll = async (): Promise<void> => {
  const all = [...engines.values()];
  engines.clear();
  await Promise.all(all.map((e) => e.stop()));
};

/**
 * Connect to Queria datasets. Declare every dataset the SQL reads by its fully qualified name;
 * the SQL refers to it by alias, such as e_stat.census.population. Short names are never resolved.
 */
export const connect = ({ datasets, apiUrl = API, wasmUrl = WASM, token }: ConnectOptions): Connection => {
  const declared = aliases(datasets);
  const auth = async (): Promise<string | null> => (token === undefined ? null : typeof token === "string" ? token : await token());
  const rows = new Map<string, Promise<Dataset>>();
  /** The dataset row, looked up once. Pass the token when the caller has already asked for it. */
  const row = (qualified: string, token?: Promise<string | null>): Promise<Dataset> => {
    const p =
      rows.get(qualified) ??
      (token ?? auth())
        .then((t) => lookup(apiUrl, qualified, t))
        .catch((e: unknown) => {
          rows.delete(qualified);
          throw e;
        });
    rows.set(qualified, p);
    return p;
  };

  /** Declared aliases the SQL references. Other three-part names are left to DuckDB (alias.column.field). */
  const used = (sql: string): string[] => datasetsIn(sql).filter((a) => declared.has(a));

  const ensure = async (e: Engine, db: AsyncDuckDB, alias: string, t: string | null): Promise<void> => {
    const qualified = declared.get(alias) ?? "";
    const prev = e.attached.get(alias);
    if (prev && prev.qualified !== qualified)
      throw new Error(`Alias ${alias} is already used for ${prev.qualified} on this page. Declare ${qualified} with another alias`);
    const done =
      prev?.done ??
      row(qualified, Promise.resolve(t))
        .then((d) => attach(db, alias, d, t))
        .catch((err: unknown) => {
          e.attached.delete(alias);
          throw err;
        });
    e.attached.set(alias, { qualified, done });
    await done;
  };

  const sql = async <T,>(query: string): Promise<T[]> => {
    const eng = engine(wasmUrl);
    const aliasesUsed = used(query);
    // Look up the datasets while DuckDB starts. The token function is called once per query.
    const token = auth();
    const [db, t, ds] = await Promise.all([eng.db(), token, Promise.all(aliasesUsed.map((a) => row(declared.get(a) ?? "", token)))]);
    // Data files are read by the DuckDB worker, so hand it the token and the hosts it may go to.
    if (t !== null) setAuth(db, t, [...new Set(ds.map((d) => new URL(d.catalog_url).origin))]);
    await Promise.all(aliasesUsed.map((a) => ensure(eng, db, a, t)));
    const run = async (): Promise<T[]> => {
      const conn = await db.connect();
      try {
        return (await conn.query(query)).toArray().map((r) => plain(r) as T);
      } finally {
        await conn.close();
      }
    };
    try {
      return await withSpatial(db, query, run);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const next = hints(message, ds, datasetsIn(query).filter((a) => !declared.has(a)));
      throw next.length === 0 ? e : new Error([message, ...next].join("\n"), { cause: e });
    }
  };

  const sources = (query?: string): Promise<Dataset[]> =>
    Promise.all((query === undefined ? [...declared.keys()] : used(query)).map((a) => row(declared.get(a) ?? "")));

  return { sql, sources };
};

/** Read a list of datasets from an HTML attribute: "queria/e_stat queria/jma" or "a=alice/x b=bob/x". */
export const parseDatasets = (attr: string): Declared => {
  const pairs = attr
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (w.includes("=") ? w.split("=", 2) : [w.split("/")[1] ?? "", w]));
  // Object.fromEntries would keep only the last of two datasets with one alias.
  if (new Set(pairs.map(([alias]) => alias)).size !== pairs.length)
    throw new Error("Two datasets share an alias. Declare them as alias=name");
  return Object.fromEntries(pairs);
};
