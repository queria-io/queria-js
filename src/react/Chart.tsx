import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { type ChartSpec, renderChart } from "../render/chart.js";
import { useQueria } from "./query.js";

type Props = { spec: ChartSpec; className?: string } & ({ sql: string } | { rows: readonly Record<string, unknown>[] });

/** A Vega-Lite chart of the SQL result (or of `rows`), followed by the sources of the datasets. */
export const Chart = ({ spec, className = "queria-chart", ...data }: Props) => {
  const conn = useQueria();
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ sources: Dataset[]; error?: unknown }>({ sources: [] });
  const sql = "sql" in data ? data.sql : null;
  const rows = "rows" in data ? data.rows : null;
  // Compare the spec by content: a spec written inline is a new object on every render of the parent.
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    let alive = true;
    let finalize: (() => void) | undefined;
    const load = sql === null ? Promise.all([rows ?? [], conn.sources()]) : Promise.all([conn.sql(sql), conn.sources(sql)]);
    load
      .then(async ([values, sources]) => {
        if (!alive || !el.current) return;
        setState({ sources });
        finalize = await renderChart(el.current, spec, values);
        if (!alive) finalize();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // finalize stops the previous chart but leaves its drawing in the element.
        el.current?.replaceChildren();
        setState({ sources: [], error });
      });
    return () => {
      alive = false;
      finalize?.();
    };
  }, [conn, sql, rows, specKey]);

  return (
    <div className={className}>
      {state.error ? <p className="queria-note">{String(state.error)}</p> : null}
      <div ref={el} />
      <div dangerouslySetInnerHTML={{ __html: attributionHtml(state.sources) }} />
    </div>
  );
};
