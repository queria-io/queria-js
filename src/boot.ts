import type { AsyncDuckDB, DuckDBBundles } from "@duckdb/duckdb-wasm";
import { stripLiterals } from "./sql.js";

/**
 * Source put before the DuckDB worker script. It adds a Bearer token to the worker's XHRs, and only to
 * the origins it was given. DuckDB WASM sends no headers of its own (neither CREATE SECRET nor
 * EXTRA_HTTP_HEADERS reach the request in the browser), and keeping the token in a JS variable of the
 * worker keeps it out of reach of SQL. It takes only { queriaAuth: { token, origins } } messages and
 * does not pass them on to DuckDB.
 */
export const authPatch = `(() => {
  let token = null;
  let origins = [];
  self.addEventListener("message", (event) => {
    const auth = event.data && typeof event.data === "object" ? event.data.queriaAuth : undefined;
    if (auth === undefined) return;
    event.stopImmediatePropagation();
    token = auth && typeof auth.token === "string" ? auth.token : null;
    origins = auth && Array.isArray(auth.origins) ? auth.origins.map((o) => String(o) + "/") : [];
  });
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    open.call(this, method, url, ...rest);
    if (token !== null && origins.some((o) => String(url).startsWith(o))) {
      this.setRequestHeader("Authorization", "Bearer " + token);
    }
  };
})();
`;

export const bundlesAt = (base: string): DuckDBBundles => ({
  mvp: { mainModule: `${base}/duckdb-mvp.wasm`, mainWorker: `${base}/duckdb-browser-mvp.worker.js` },
  eh: { mainModule: `${base}/duckdb-eh.wasm`, mainWorker: `${base}/duckdb-browser-eh.worker.js` },
});

const workers = new WeakMap<AsyncDuckDB, Worker>();
const authOrigins = new WeakMap<AsyncDuckDB, Set<string>>();

/**
 * Send the token to these origins from now on, as well as to the origins given before: queries run
 * concurrently, and one that is still reading must keep its origins. A null token sends none.
 */
export const setAuth = (db: AsyncDuckDB, token: string | null, origins: readonly string[]): void => {
  const all = token === null ? new Set<string>() : new Set([...(authOrigins.get(db) ?? []), ...origins]);
  authOrigins.set(db, all);
  workers.get(db)?.postMessage({ queriaAuth: { token, origins: [...all] } });
};

const instantiate = async (bundles: DuckDBBundles): Promise<AsyncDuckDB> => {
  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundle = await duckdb.selectBundle(bundles);
  if (!bundle.mainWorker) throw new Error("The DuckDB bundle has no worker script");
  // The worker lives on another origin, and a page with a strict-dynamic CSP blocks importScripts,
  // so fetch the script and start it from a blob URL.
  const res = await fetch(bundle.mainWorker);
  if (!res.ok) throw new Error(`${bundle.mainWorker}: ${res.status}`);
  const url = URL.createObjectURL(new Blob([authPatch, await res.text()], { type: "text/javascript" }));
  try {
    // A CSP without blob: in worker-src throws here, so this is inside the try that revokes the URL.
    const worker = new Worker(url);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    try {
      // Pages without cross-origin isolation cannot start threads.
      await (bundle.pthreadWorker
        ? db.instantiate(bundle.mainModule, bundle.pthreadWorker).catch(() => db.instantiate(bundle.mainModule))
        : db.instantiate(bundle.mainModule));
    } catch (e) {
      await db.terminate().catch(() => undefined);
      throw e;
    }
    workers.set(db, worker);
    return db;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Start DuckDB from the given WASM URL, and from jsDelivr when that fails. */
export const boot = async (wasm: string): Promise<AsyncDuckDB> => {
  const db = await instantiate(bundlesAt(wasm)).catch(async (e: unknown) => {
    const { getJsDelivrBundles } = await import("@duckdb/duckdb-wasm");
    return instantiate(getJsDelivrBundles()).catch((e2: unknown) => {
      throw new AggregateError([e, e2], "DuckDB WASM could not be started");
    });
  });
  try {
    // Read Parquet by range instead of downloading whole files. Arrow returns DECIMAL as an unscaled
    // integer, so let DuckDB convert it to DOUBLE.
    await db.open({ path: ":memory:", filesystem: { forceFullHTTPReads: false }, query: { castDecimalToDouble: true } });
    const conn = await db.connect();
    await conn.query("INSTALL ducklake; LOAD ducklake").finally(() => conn.close());
  } catch (e) {
    await db.terminate().catch(() => undefined);
    throw e;
  }
  return db;
};

// The spatial extension is large, so it is loaded only for SQL that needs it, and on the error
// DuckDB gives for a missing spatial function.

/** Whether the SQL calls an ST_* function outside string literals and comments. */
export const needsSpatial = (sql: string): boolean => /\bST_\w+\s*\(/i.test(stripLiterals(sql));

/** Whether the error comes from the spatial extension not being loaded. */
export const isSpatialMissing = (message: string): boolean =>
  /exists in the spatial extension/i.test(message) || /\b(function|type) with name (st_\w+|geometry)\b.*does not exist/i.test(message);

const spatial = new WeakMap<AsyncDuckDB, Promise<void>>();
const spatialLoaded = new WeakSet<AsyncDuckDB>();

export const loadSpatial = (db: AsyncDuckDB): Promise<void> => {
  const found = spatial.get(db);
  if (found) return found;
  const p = db
    .connect()
    .then((conn) => conn.query("INSTALL spatial; LOAD spatial").finally(() => conn.close()))
    .then(() => {
      spatialLoaded.add(db);
    })
    .catch((e: unknown) => {
      spatial.delete(db);
      throw e;
    });
  spatial.set(db, p);
  return p;
};

/** Run fn, loading spatial first when the SQL needs it, and once more after a missing-spatial error. */
export const withSpatial = async <T>(db: AsyncDuckDB, sql: string, fn: () => Promise<T>): Promise<T> => {
  if (needsSpatial(sql)) await loadSpatial(db);
  // Once spatial is loaded, running the SQL again gives the same error.
  const loaded = spatialLoaded.has(db);
  try {
    return await fn();
  } catch (e) {
    if (loaded || !isSpatialMissing(String(e))) throw e;
    await loadSpatial(db);
    return fn();
  }
};
