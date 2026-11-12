import type { TableOptions } from "../render/table.js";
import { renderTable } from "../render/table.js";
import { type Data, Frame, useDraw, useResult } from "./result.js";

type Props = { className?: string } & TableOptions & Data;

/** The SQL result (or `rows`) as a table, followed by the sources. Its height is the CSS variable --queria-table-height (400px by default). */
export const Table = ({ className = "queria-table", limit, ...data }: Props) => {
  const result = useResult(data);
  // A change of limit redraws without running the SQL again.
  const [ref, error] = useDraw(result.values, (el, rows) => renderTable(el, rows, { limit }), [limit]);
  return <Frame className={className} result={result} error={error}><div ref={ref} /></Frame>;
};
