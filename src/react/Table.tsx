import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { renderTable, type TableOptions } from "../render/table.js";
import { useQueria } from "./query.js";

type Props = { className?: string } & TableOptions & ({ sql: string } | { rows: readonly Record<string, unknown>[] });

/** The SQL result (or `rows`) as a table, followed by the sources. Its height is the CSS variable --queria-table-height (400px by default). */
export const Table = ({ className = "queria-table", limit, ...data }: Props) => {
  const conn = useQueria();
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ sources: Dataset[]; url?: string; error?: unknown }>({ sources: [] });
  const sql = "sql" in data ? data.sql : null;
  const rows = "rows" in data ? data.rows : null;

  useEffect(() => {
    let alive = true;
    let finalize: (() => void) | undefined;
    const load = sql === null
      ? Promise.all([rows ?? [], conn.sources(), undefined])
      : Promise.all([conn.sql(sql), conn.sources(sql), conn.shareUrl(sql)]);
    load
      .then(([values, sources, url]) => {
        if (!alive || !el.current) return;
        setState({ sources, url });
        ({ finalize } = renderTable(el.current, values, { limit }));
      })
      .catch((error: unknown) => {
        if (alive) setState({ sources: [], error });
      });
    return () => {
      alive = false;
      finalize?.();
    };
  }, [conn, sql, rows, limit]);

  return (
    <div className={className}>
      {state.error ? <p className="queria-note">{state.error instanceof Error ? state.error.message : String(state.error)}</p> : null}
      <div ref={el} />
      <div dangerouslySetInnerHTML={{ __html: attributionHtml(state.sources, sql !== null && state.url ? { sql, url: state.url } : undefined) }} />
    </div>
  );
};
