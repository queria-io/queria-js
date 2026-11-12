import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { type Connection, type ConnectOptions, connect } from "../client.js";

const Context = createContext<Connection | null>(null);

/** Declare the datasets for the components below: <QueriaProvider datasets={["queria/e_stat"]}>. */
export const QueriaProvider = ({ children, ...options }: ConnectOptions & { children: ReactNode }) => {
  const key = JSON.stringify(options);
  const conn = useMemo(() => connect(options), [key]);
  return <Context.Provider value={conn}>{children}</Context.Provider>;
};

export const useQueria = (): Connection => {
  const conn = useContext(Context);
  if (!conn) throw new Error("Wrap the component in <QueriaProvider datasets={[...]}>");
  return conn;
};

export type QueryState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; rows: T[] }
  | { status: "error"; error: unknown };

/** Run SQL and re-run it when the SQL changes. Pass null to skip; the state is then idle. */
export const useQuery = <T = Record<string, unknown>,>(sql: string | null): QueryState<T> => {
  const conn = useQueria();
  const [state, setState] = useState<QueryState<T>>(sql === null ? { status: "idle" } : { status: "loading" });
  useEffect(() => {
    if (sql === null) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    conn.sql<T>(sql).then(
      (rows) => alive && setState({ status: "done", rows }),
      (error: unknown) => alive && setState({ status: "error", error }),
    );
    return () => {
      alive = false;
    };
  }, [conn, sql]);
  return state;
};
