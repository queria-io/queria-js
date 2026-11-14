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
const pad = "padding:6px 12px";
const stripe = "background:var(--queria-table-stripe,color-mix(in srgb,currentColor 4%,transparent))";

/** Whether a value is a web address that a cell shows as a link: http or https, with no spaces. */
export const isLink = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+$/i.test(v);

const header = (text: string, right: boolean): HTMLElement =>
  Object.assign(document.createElement("th"), {
    textContent: text,
    style: `position:sticky;top:0;z-index:1;${pad};${border};white-space:nowrap;vertical-align:bottom;font-weight:600;background:var(--queria-table-header-background,Canvas);text-align:${right ? "right" : "left"}`,
  });

const link = (url: string): HTMLElement =>
  Object.assign(document.createElement("a"), { href: url, textContent: url, target: "_blank", rel: "noopener noreferrer", style: "color:var(--queria-table-link,LinkText)" });

// A long text keeps its column at least this wide, so a narrow page scrolls sideways instead of making it a tall strip.
const LONG_TEXT = 16;

// Numbers stay on one line. Text wraps at --queria-table-cell-width, so every value is shown in full.
const cell = (v: unknown, right: boolean, grouping: boolean, nullText: string): HTMLElement => {
  const isNull = v === null || v === undefined;
  const text = isNull ? nullText : cellText(v, grouping);
  const align = right
    ? "white-space:nowrap;text-align:right"
    : `white-space:pre-wrap;overflow-wrap:anywhere;max-width:var(--queria-table-cell-width,24em);text-align:left${text.length > LONG_TEXT ? ";min-width:min(16em,var(--queria-table-cell-width,24em))" : ""}`;
  const td = Object.assign(document.createElement("td"), {
    style: `${pad};${border};vertical-align:top;${align}${isNull ? `;${muted}` : ""}`,
  });
  if (isLink(v)) td.append(link(v));
  else td.textContent = text;
  return td;
};

/**
 * Draw rows as a table. Number columns are aligned right, with every decimal digit kept. Integers are grouped from
 * 10,000, except in columns named as codes, IDs or dates (isCodeColumn). Values come from the data, so they are set as text;
 * http and https addresses become links that open in a new tab. Text wraps at --queria-table-cell-width (24em by
 * default) and is never cut. Every other row is shaded. The height is the CSS variable --queria-table-height (400px by
 * default); it scrolls beyond, with the header kept in view. The colors follow the page; --queria-table-border,
 * --queria-table-muted, --queria-table-header-background, --queria-table-stripe and --queria-table-link change them,
 * and --queria-table-font changes the font.
 */
export const renderTable = (
  el: HTMLElement,
  rows: Rows,
  { limit = 100, columns = Object.keys(rows[0] ?? {}), nullText = "", right = [] }: TableOptions = {},
): { finalize: () => void } => {
  const numeric = new Set([...numericColumns(rows, columns), ...right]);
  const codes = new Set(columns.filter(isCodeColumn));
  const table = Object.assign(document.createElement("table"), {
    style: "border-collapse:separate;border-spacing:0;font:var(--queria-table-font,14px/1.5 system-ui,sans-serif)",
  });
  const head = table.createTHead().insertRow();
  columns.forEach((c) => head.append(header(c, numeric.has(c))));
  const body = table.createTBody();
  rows.slice(0, limit).forEach((r, i) => {
    const tr = body.insertRow();
    if (i % 2 === 1) tr.style.cssText = stripe;
    columns.forEach((c) => tr.append(cell(r[c], numeric.has(c), !codes.has(c), nullText)));
  });
  const box = Object.assign(document.createElement("div"), { style: "overflow:auto;max-height:var(--queria-table-height,400px)" });
  box.append(table);
  const more = rows.length > limit ? [Object.assign(document.createElement("p"), { textContent: `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows`, style: `margin:4px 0 0;font:12px system-ui,sans-serif;${muted}` })] : [];
  el.append(box, ...more);
  return { finalize: () => [box, ...more].forEach((n) => n.remove()) };
};
