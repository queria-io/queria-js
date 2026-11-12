import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { type ChartSpec, renderChart, type Tone } from "../render/chart.js";
import { useQueria } from "./query.js";

type Props = { spec: ChartSpec; className?: string; theme?: Tone; highlight?: unknown } & ({ sql: string } | { rows: readonly Record<string, unknown>[] });

/** A Vega-Lite chart of the SQL result (or of `rows`), followed by the sources of the datasets. */
export const Chart = ({ spec, className = "queria-chart", theme, highlight, ...data }: Props) => {
  const conn = useQueria();
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ sources: Dataset[]; url?: string; error?: unknown }>({ sources: [] });
  const sql = "sql" in data ? data.sql : null;
  const rows = "rows" in data ? data.rows : null;
  // Compare the spec by content: a spec written inline is a new object on every render of the parent.
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    let alive = true;
    let finalize: (() => void) | undefined;
    const load = sql === null
      ? Promise.all([rows ?? [], conn.sources(), undefined])
      : Promise.all([conn.sql(sql), conn.sources(sql), conn.shareUrl(sql, spec)]);
    load
      .then(async ([values, sources, url]) => {
        if (!alive || !el.current) return;
        setState({ sources, url });
        ({ finalize } = await renderChart(el.current, spec, values, { theme, highlight }));
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
  }, [conn, sql, rows, specKey, theme, JSON.stringify(highlight)]);

  return (
    <div className={className}>
      {state.error ? <p className="queria-note">{state.error instanceof Error ? state.error.message : String(state.error)}</p> : null}
      <div ref={el} />
      <div dangerouslySetInnerHTML={{ __html: attributionHtml(state.sources, sql !== null && state.url ? { sql, url: state.url } : undefined) }} />
    </div>
  );
};
