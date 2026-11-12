import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { datasetsIn } from "./sql.js";

export type QueriaOptions = {
  /** Base URL of the published datasets. */
  dataUrl?: string;
  /** Base URL of the DuckDB WASM bundles. */
  wasmUrl?: string;
};

export type Queria = {
  /** Run SQL and return rows as plain objects. Referenced datasets are attached on first use. */
  query: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
  /** Attach datasets ahead of the first query. */
  preload: (names: readonly string[]) => Promise<void>;
  /** Stop DuckDB and its worker. A later query starts it again. */
  close: () => Promise<void>;
};

const DATA = "https://data.queria.io/datasets/queria";
// Must match the @duckdb/duckdb-wasm version in package.json "dependencies".
const WASM = "https://assets.queria.io/duckdb-wasm/1.33.1-dev57.0";

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

/**
 * Attach one dataset. The catalog is fetched in a single GET: letting DuckDB read it by range
 * costs hundreds of 16 KiB round trips for large catalogs. Data files are still read by range.
 * A name with no catalog (404) is not a dataset, such as alias.column.field, and is left to DuckDB.
 */
const attach = async (db: AsyncDuckDB, data: string, name: string): Promise<void> => {
  const url = `${data}/${name}/ducklake.duckdb`;
  const res = await fetch(url);
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await db.registerFileBuffer(`${name}.duckdb`, new Uint8Array(await res.arrayBuffer()));
  const conn = await db.connect();
  try {
    await conn.query(
      `ATTACH 'ducklake:${name}.duckdb' AS ${name} (READ_ONLY, DATA_PATH '${data}/${name}/ducklake.duckdb.files/', OVERRIDE_DATA_PATH true)`,
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

/** Create a client for Queria open data. DuckDB starts on the first query. */
export const createQueria = ({ dataUrl = DATA, wasmUrl = WASM }: QueriaOptions = {}): Queria => {
  let dbPromise: Promise<AsyncDuckDB> | null = null;
  const attached = new Map<string, Promise<void>>();

  const getDB = (): Promise<AsyncDuckDB> =>
    (dbPromise ??= boot(wasmUrl).catch((e: unknown) => {
      dbPromise = null;
      attached.clear();
      throw e;
    }));

  const preload = async (names: readonly string[]): Promise<void> => {
    const db = await getDB();
    await Promise.all(
      names.map((name) => {
        const p =
          attached.get(name) ??
          attach(db, dataUrl, name).catch((e: unknown) => {
            attached.delete(name);
            throw e;
          });
        attached.set(name, p);
        return p;
      }),
    );
  };

  const query = async <T,>(sql: string): Promise<T[]> => {
    await preload(datasetsIn(sql));
    const conn = await (await getDB()).connect();
    try {
      const table = await conn.query(sql);
      return table.toArray().map((row) => plain(row) as T);
    } finally {
      await conn.close();
    }
  };

  const close = async (): Promise<void> => {
    const db = dbPromise;
    dbPromise = null;
    attached.clear();
    // A failed start was already reported to the query that started it.
    await db?.then((d) => d.terminate(), () => undefined);
  };

  return { query, preload, close };
};

let shared: Queria | null = null;

/** The client shared by the Web Components and by React components outside a provider. */
export const sharedQueria = (): Queria => (shared ??= createQueria());

/** Replace the shared client, for example to read datasets from another host. The previous one is closed. */
export const configureQueria = (options: QueriaOptions): Queria => {
  shared?.close();
  return (shared = createQueria(options));
};
