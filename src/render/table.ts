import type { Rows } from "./chart.js";

export type TableOptions = {
  /** Rows shown at most. 100 by default. */
  limit?: number;
  /** Columns in the order shown. By default, the keys of the first row. */
  columns?: string[];
  /** Text shown for NULL, in the muted color. Empty by default. */
  nullText?: string;
  /**
   * Columns aligned right besides the ones holding only numbers, such as DECIMAL values passed as text to keep
   * their digits.
   */
  right?: string[];
};

// The last word of a column name that holds codes, IDs or dates written as integers (13101, 202401).
const CODE_WORDS = new Set(["code", "cd", "id", "no", "year", "yyyy", "month", "ym", "yyyymm", "ymd", "yyyymmdd", "fy", "nendo", "date"]);

/**
 * Whether a column holds codes, IDs or dates rather than quantities, by its name: the last word is one of
 * code, id, no, year, month, ym, yyyymm, date and the like (lg_code, survey_year, cityCode), or the name ends in
 * コード, 番号, 年月, 年度 or ID, or is 年 or 月. Integers in these columns are written without digit grouping.
 */
export const isCodeColumn = (name: string): boolean =>
  /(コード|番号|年月日?|年度|ID)$|^[年月]$/.test(name) ||
  CODE_WORDS.has(name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split(/[_\s.-]+/).pop()?.toLowerCase() ?? "");

const bigintSafe = (_: string, x: unknown) => (typeof x === "bigint" ? x.toString() : x);

// Every digit of the shortest text that reads back as the same number, grouped in the locale. Numbers that
// JavaScript writes with an exponent (under 1e-6, 1e21 and over) keep it, as do ones with more decimals than Intl
// takes.
const numberText = (v: number, grouping: boolean): string => {
  const plain = String(v);
  const decimals = plain.split(".")[1]?.length ?? 0;
  return /[eE]|NaN|Infinity/.test(plain) || decimals > 20
    ? plain
    : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
};

/**
 * A cell's text: numbers with every digit and with digit grouping, objects as JSON, NULL as empty. Integers under
 * 10,000 are not grouped, so years read as written; pass grouping false for a column of codes (see isCodeColumn).
 */
export const cellText = (v: unknown, grouping = true): string =>
  v === null || v === undefined
    ? ""
    : typeof v === "number"
      ? numberText(v, grouping && !(Number.isInteger(v) && Math.abs(v) < 10000))
      : typeof v === "bigint"
        ? v.toLocaleString(undefined, { useGrouping: grouping && (v >= 10000n || v <= -10000n) })
        : typeof v === "object" ? JSON.stringify(v, bigintSafe) : String(v);

const isNumber = (v: unknown) => typeof v === "number" || typeof v === "bigint";

/** The columns whose values are all numbers (or bigints) or NULL. They are aligned right. */
export const numericColumns = (rows: Rows, columns: string[]): Set<string> =>
  new Set(columns.filter((c) => rows.every((r) => r[c] === null || r[c] === undefined || isNumber(r[c]))));

const border = "border-bottom:1px solid var(--queria-table-border,color-mix(in srgb,currentColor 15%,transparent))";
const muted = "color:var(--queria-table-muted,color-mix(in srgb,currentColor 55%,transparent))";

const header = (text: string, right: boolean): HTMLElement =>
  Object.assign(document.createElement("th"), {
    textContent: text,
    style: `position:sticky;top:0;padding:4px 8px;${border};white-space:nowrap;font-weight:500;background:var(--queria-table-header-background,Canvas);text-align:${right ? "right" : "left"}`,
  });

// A long value is cut to --queria-table-cell-width with an ellipsis; the title shows all of it.
const cell = (v: unknown, right: boolean, grouping: boolean, nullText: string): HTMLElement => {
  const isNull = v === null || v === undefined;
  const text = isNull ? nullText : cellText(v, grouping);
  return Object.assign(document.createElement("td"), {
    textContent: text,
    title: isNull ? "" : text,
    style: `padding:4px 8px;${border};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:var(--queria-table-cell-width,20em);text-align:${right ? "right" : "left"}${isNull ? `;${muted}` : ""}`,
  });
};

/**
 * Draw rows as a table. Number columns are aligned right, with every decimal digit kept. Integers are grouped from
 * 10,000, except in columns named as codes, IDs or dates (isCodeColumn). Values come from the data, so they are set as text. The
 * height is the CSS variable --queria-table-height (400px by default); it scrolls beyond, with the header kept in view.
 * The colors follow the page; --queria-table-border, --queria-table-muted and --queria-table-header-background change
 * them, and --queria-table-font changes the font.
 */
export const renderTable = (
  el: HTMLElement,
  rows: Rows,
  { limit = 100, columns = Object.keys(rows[0] ?? {}), nullText = "", right = [] }: TableOptions = {},
): { finalize: () => void } => {
  const numeric = new Set([...numericColumns(rows, columns), ...right]);
  const codes = new Set(columns.filter(isCodeColumn));
  const table = Object.assign(document.createElement("table"), {
    style: "border-collapse:separate;border-spacing:0;font:var(--queria-table-font,13px/1.4 system-ui,sans-serif)",
  });
  const head = table.createTHead().insertRow();
  columns.forEach((c) => head.append(header(c, numeric.has(c))));
  const body = table.createTBody();
  rows.slice(0, limit).forEach((r) => {
    const tr = body.insertRow();
    columns.forEach((c) => tr.append(cell(r[c], numeric.has(c), !codes.has(c), nullText)));
  });
  const box = Object.assign(document.createElement("div"), { style: "overflow:auto;max-height:var(--queria-table-height,400px)" });
  box.append(table);
  const more = rows.length > limit ? [Object.assign(document.createElement("p"), { textContent: `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows`, style: `margin:4px 0 0;font:12px system-ui,sans-serif;${muted}` })] : [];
  el.append(box, ...more);
  return { finalize: () => [box, ...more].forEach((n) => n.remove()) };
};
