import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { createQueria, type Queria, type QueriaOptions, sharedQueria } from "../client.js";

const Context = createContext<Queria | null>(null);

/** Use a client with other options for the components below. Without a provider, the shared client is used. */
export const QueriaProvider = ({ children, ...options }: QueriaOptions & { children: ReactNode }) => {
  const client = useMemo(() => createQueria(options), [options.dataUrl, options.wasmUrl]);
  // Stop the DuckDB worker when the options change or the provider unmounts.
  useEffect(
    () => () => {
      client.close();
    },
    [client],
  );
  return <Context.Provider value={client}>{children}</Context.Provider>;
};

export const useQueria = (): Queria => useContext(Context) ?? sharedQueria();

export type QueryState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; rows: T[] }
  | { status: "error"; error: unknown };

/** Run SQL and re-run it when the SQL changes. Pass null to skip; the state is then idle. */
export const useQuery = <T = Record<string, unknown>,>(sql: string | null): QueryState<T> => {
  const { query } = useQueria();
  const [state, setState] = useState<QueryState<T>>(sql === null ? { status: "idle" } : { status: "loading" });
  useEffect(() => {
    if (sql === null) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    query<T>(sql).then(
      (rows) => alive && setState({ status: "done", rows }),
      (error: unknown) => alive && setState({ status: "error", error }),
    );
    return () => {
      alive = false;
    };
  }, [query, sql]);
  return state;
};
