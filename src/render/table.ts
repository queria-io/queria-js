import type { Rows } from "./chart.js";

export type TableOptions = {
  /** Rows shown at most. 100 by default. */
  limit?: number;
};

/**
 * A cell's text: numbers with digit grouping, objects as JSON, NULL as empty. Integers under 10,000 are not grouped,
 * so years and codes read as written.
 */
export const cellText = (v: unknown): string =>
  v === null || v === undefined
    ? ""
    : typeof v === "number"
      ? Number.isInteger(v) && Math.abs(v) < 10000 ? String(v) : v.toLocaleString()
      : typeof v === "object" ? JSON.stringify(v) : String(v);

const cell = (tag: "th" | "td", text: string, right: boolean): HTMLElement =>
  Object.assign(document.createElement(tag), {
    textContent: text,
    style: `padding:4px 8px;border-bottom:1px solid #e5e5e5;white-space:nowrap;text-align:${right ? "right" : "left"}`,
  });

/**
 * Draw rows as a table. Columns come from the first row; number columns are aligned right. Values come from the data,
 * so they are set as text. The height is the CSS variable --queria-table-height (400px by default); it scrolls beyond.
 */
export const renderTable = (el: HTMLElement, rows: Rows, { limit = 100 }: TableOptions = {}): { finalize: () => void } => {
  const columns = Object.keys(rows[0] ?? {});
  const numeric = new Set(columns.filter((c) => rows.every((r) => r[c] === null || typeof r[c] === "number")));
  const table = Object.assign(document.createElement("table"), { style: "border-collapse:collapse;font:13px/1.4 system-ui,sans-serif" });
  const head = table.createTHead().insertRow();
  columns.forEach((c) => head.append(cell("th", c, numeric.has(c))));
  const body = table.createTBody();
  rows.slice(0, limit).forEach((r) => {
    const tr = body.insertRow();
    columns.forEach((c) => tr.append(cell("td", cellText(r[c]), numeric.has(c))));
  });
  const box = Object.assign(document.createElement("div"), { style: "overflow:auto;max-height:var(--queria-table-height,400px)" });
  box.append(table);
  const more = rows.length > limit ? [Object.assign(document.createElement("p"), { textContent: `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows`, style: "margin:4px 0 0;font:12px system-ui,sans-serif;color:#737373" })] : [];
  el.append(box, ...more);
  return { finalize: () => [box, ...more].forEach((n) => n.remove()) };
};
