import type { Rows } from "./chart.js";

export type TableOptions = {
  /** Rows shown at most. 100 by default. */
  limit?: number;
  /** Columns in the order shown. By default, the keys of the first row. */
  columns?: string[];
  /** Text shown for NULL, in the muted color. Empty by default. */
  nullText?: string;
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

/** The columns whose values are all numbers or NULL. They are aligned right. */
export const numericColumns = (rows: Rows, columns: string[]): Set<string> =>
  new Set(columns.filter((c) => rows.every((r) => r[c] === null || r[c] === undefined || typeof r[c] === "number")));

const border = "border-bottom:1px solid var(--queria-table-border,color-mix(in srgb,currentColor 15%,transparent))";
const muted = "color:var(--queria-table-muted,color-mix(in srgb,currentColor 55%,transparent))";

const header = (text: string, right: boolean): HTMLElement =>
  Object.assign(document.createElement("th"), {
    textContent: text,
    style: `position:sticky;top:0;padding:4px 8px;${border};white-space:nowrap;font-weight:500;background:var(--queria-table-header-background,Canvas);text-align:${right ? "right" : "left"}`,
  });

// A long value is cut to --queria-table-cell-width with an ellipsis; the title shows all of it.
const cell = (v: unknown, right: boolean, nullText: string): HTMLElement => {
  const isNull = v === null || v === undefined;
  const text = isNull ? nullText : cellText(v);
  return Object.assign(document.createElement("td"), {
    textContent: text,
    title: isNull ? "" : text,
    style: `padding:4px 8px;${border};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:var(--queria-table-cell-width,20em);text-align:${right ? "right" : "left"}${isNull ? `;${muted}` : ""}`,
  });
};

/**
 * Draw rows as a table. Number columns are aligned right. Values come from the data, so they are set as text. The
 * height is the CSS variable --queria-table-height (400px by default); it scrolls beyond, with the header kept in view.
 * The colors follow the page; --queria-table-border, --queria-table-muted and --queria-table-header-background change
 * them, and --queria-table-font changes the font.
 */
export const renderTable = (
  el: HTMLElement,
  rows: Rows,
  { limit = 100, columns = Object.keys(rows[0] ?? {}), nullText = "" }: TableOptions = {},
): { finalize: () => void } => {
  const numeric = numericColumns(rows, columns);
  const table = Object.assign(document.createElement("table"), {
    style: "border-collapse:separate;border-spacing:0;font:var(--queria-table-font,13px/1.4 system-ui,sans-serif)",
  });
  const head = table.createTHead().insertRow();
  columns.forEach((c) => head.append(header(c, numeric.has(c))));
  const body = table.createTBody();
  rows.slice(0, limit).forEach((r) => {
    const tr = body.insertRow();
    columns.forEach((c) => tr.append(cell(r[c], numeric.has(c), nullText)));
  });
  const box = Object.assign(document.createElement("div"), { style: "overflow:auto;max-height:var(--queria-table-height,400px)" });
  box.append(table);
  const more = rows.length > limit ? [Object.assign(document.createElement("p"), { textContent: `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows`, style: `margin:4px 0 0;font:12px system-ui,sans-serif;${muted}` })] : [];
  el.append(box, ...more);
  return { finalize: () => [box, ...more].forEach((n) => n.remove()) };
};
