import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Dataset } from "../client.js";
import { attributionHtml, SAVE_IMAGE_CLASS } from "../render/attribution.js";
import type { Rows } from "../render/chart.js";
import { useQueria } from "./query.js";

export type Data = { sql: string } | { rows: Rows };

/** Rows with the sources and the SQL that made them, so the drawing, the sources and the SQL link always match. */
export type Result = { values?: Rows; sources: Dataset[]; sql?: string; url?: string; error?: unknown };

/** Run the SQL (or take `rows`) with its sources and share link. The previous result stays until the next one arrives. */
export const useResult = (data: Data, spec?: object): Result => {
  const conn = useQueria();
  const [result, setResult] = useState<Result>({ sources: [] });
  const sql = "sql" in data ? data.sql : null;
  const rows = "rows" in data ? data.rows : null;
  // A spec written inline is a new object on every render of the parent, so compare it by content.
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    let alive = true;
    const load = sql === null
      ? Promise.all([rows ?? [], conn.sources(), undefined])
      : Promise.all([conn.sql(sql), conn.sources(sql), conn.shareUrl(sql, spec)]);
    load.then(
      ([values, sources, url]) => alive && setResult({ values, sources, url, sql: sql ?? undefined }),
      (error: unknown) => alive && setResult({ sources: [], error }),
    );
    return () => {
      alive = false;
    };
  }, [conn, sql, rows, specKey]);
  return result;
};

/**
 * Draw the rows into the returned element when they or `deps` change. Each drawing gets its own element, removed with it:
 * a map removed after the next one started takes its class off its element. A failure is returned as the error.
 */
export const useDraw = (
  values: Rows | undefined,
  draw: (el: HTMLElement, values: Rows) => Promise<{ finalize: () => void }> | { finalize: () => void },
  deps: readonly unknown[],
) => {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!ref.current || !values?.length) return;
    let alive = true;
    let finalize: (() => void) | undefined;
    const box = Object.assign(document.createElement("div"), { style: "height:100%" });
    ref.current.append(box);
    setError(undefined);
    Promise.resolve(draw(box, values)).then(
      (r) => (alive ? (finalize = r.finalize) : r.finalize()),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
      finalize?.();
      box.remove();
    };
  }, [values, ...deps]);
  return [ref, error] as const;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const message = ({ values, error }: Result, drawError: unknown): string | null =>
  error ? errorText(error)
    : drawError ? errorText(drawError)
    : values === undefined ? "Loading…"
    : values.length === 0 ? "The SQL returned no rows."
    : null;

/**
 * The note (loading, no rows or the error), the drawing, then the sources and the SQL link.
 * With `onSaveImage`, a "Save image" button in the line of sources calls it once the drawing is shown.
 */
export const Frame = ({
  className,
  result,
  error,
  onSaveImage,
  children,
}: {
  className: string;
  result: Result;
  error?: unknown;
  onSaveImage?: () => Promise<void>;
  children: ReactNode;
}) => {
  const note = message(result, error);
  const { sql, url, sources } = result;
  const saveImage = onSaveImage !== undefined && note === null;
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Element) || e.target.closest(`.${SAVE_IMAGE_CLASS}`) === null) return;
    onSaveImage?.().catch((err: unknown) => console.error("[queria] Save image:", err));
  };
  return (
    <div className={className}>
      {note === null ? null : <p className="queria-note">{note}</p>}
      {children}
      <div
        onClick={saveImage ? onClick : undefined}
        dangerouslySetInnerHTML={{ __html: attributionHtml(sources, sql !== undefined && url ? { sql, url } : undefined, { saveImage }) }}
      />
    </div>
  );
};
