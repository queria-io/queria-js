import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { type MapLayer, type MapRenderOptions, renderMap } from "../render/data-map.js";
import { useQueria } from "./query.js";

type Props = { layer: MapLayer; className?: string } & MapRenderOptions &
  ({ sql: string } | { rows: readonly Record<string, unknown>[] });

/** The SQL result (or `rows`) on a map by area code or by lng/lat, followed by the sources. Its height is the CSS variable --queria-map-height (400px by default). */
export const DataMap = ({ layer, className = "queria-map", style, theme, ...data }: Props) => {
  const conn = useQueria();
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ sources: Dataset[]; error?: unknown }>({ sources: [] });
  const sql = "sql" in data ? data.sql : null;
  const rows = "rows" in data ? data.rows : null;
  // Inline objects are new on every render of the parent, so compare them by content.
  const key = JSON.stringify([layer, style, theme]);

  useEffect(() => {
    let alive = true;
    let finalize: (() => void) | undefined;
    const load = sql === null ? Promise.all([rows ?? [], conn.sources()]) : Promise.all([conn.sql(sql), conn.sources(sql)]);
    load
      .then(async ([values, sources]) => {
        if (!alive || !el.current) return;
        setState({ sources });
        ({ finalize } = await renderMap(el.current, layer, values, { style, theme }));
        if (!alive) finalize();
      })
      .catch((error: unknown) => {
        if (alive) setState({ sources: [], error });
      });
    return () => {
      alive = false;
      finalize?.();
    };
  }, [conn, sql, rows, key]);

  return (
    <div className={className}>
      {state.error ? <p className="queria-note">{String(state.error)}</p> : null}
      <div ref={el} style={{ height: "var(--queria-map-height, 400px)" }} />
      <div dangerouslySetInnerHTML={{ __html: attributionHtml(state.sources) }} />
    </div>
  );
};
