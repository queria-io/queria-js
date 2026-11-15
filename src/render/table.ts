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

const LABELS = {
  ja: { copy: "コピー", copied: "コピーしました", close: "閉じる" },
  en: { copy: "Copy", copied: "Copied", close: "Close" },
};

const button = (text: string, onclick: () => void): HTMLButtonElement =>
  Object.assign(document.createElement("button"), { type: "button", textContent: text, onclick, style: "font:inherit;padding:2px 10px;cursor:pointer" });

// A popover beside a cell with its column name and full value, and buttons that copy the value and close it. It closes
// on a click outside, Esc or a scroll. Where the page may not write to the clipboard, Copy selects the value instead.
const cellPopover = (lang: string | null | undefined, onClose: () => void) => {
  const labels = lang?.toLowerCase().startsWith("ja") ? LABELS.ja : LABELS.en;
  const pop = Object.assign(document.createElement("div"), {
    popover: "auto",
    style: `position:fixed;inset:auto;margin:0;box-sizing:border-box;max-width:min(24em,calc(100vw - 16px));max-height:50vh;overflow:auto;padding:10px 12px;${border.replace("border-bottom", "border")};border-radius:8px;box-shadow:0 4px 16px rgb(0 0 0/.2);color:inherit;background:var(--queria-table-header-background,Canvas);font:var(--queria-table-font,14px/1.5 system-ui,sans-serif)`,
  });
  const title = Object.assign(document.createElement("div"), { style: `font-weight:600;overflow-wrap:anywhere;${muted}` });
  const value = Object.assign(document.createElement("div"), { style: "margin:4px 0 10px;white-space:pre-wrap;overflow-wrap:anywhere" });
  const copy = button(labels.copy, () =>
    // Promise.resolve runs writeText inside the promise, so a page without navigator.clipboard falls back too.
    Promise.resolve().then(() => navigator.clipboard.writeText(value.textContent ?? "")).then(
      () => {
        copy.textContent = labels.copied;
      },
      () => getSelection()?.selectAllChildren(value),
    ),
  );
  const hide = () => pop.matches(":popover-open") && pop.hidePopover();
  const actions = Object.assign(document.createElement("div"), { style: "display:flex;gap:8px" });
  actions.append(copy, button(labels.close, hide));
  pop.append(title, value, actions);
  pop.addEventListener("toggle", (e) => {
    if (e instanceof ToggleEvent && e.newState === "closed") {
      removeEventListener("scroll", hide, true);
      onClose();
    }
  });
  return {
    pop,
    // Right of the cell, or below it where the right side has no room, kept inside the window.
    show: (td: HTMLElement, column: string, text: string) => {
      title.textContent = column;
      value.textContent = text;
      copy.textContent = labels.copy;
      // Measured at the top left, so its width does not depend on where it was last shown.
      Object.assign(pop.style, { left: "0", top: "0" });
      pop.showPopover();
      const cell = td.getBoundingClientRect();
      const { width, height } = pop.getBoundingClientRect();
      const right = cell.right + 4 + width <= innerWidth - 8;
      const left = right ? cell.right + 4 : Math.max(8, Math.min(cell.left, innerWidth - width - 8));
      const top = Math.max(8, Math.min(right ? cell.top : cell.bottom + 4, innerHeight - height - 8));
      Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
      addEventListener("scroll", hide, true);
    },
  };
};

// The text the popover shows and copies: numbers as JavaScript writes them, without digit grouping or the locale's
// decimal sign, so they paste back as numbers.
const copyText = (v: unknown): string => (isNumber(v) ? String(v) : cellText(v, false));

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
    style: `${pad};${border};vertical-align:top;${align}${isNull ? `;${muted}` : ";cursor:pointer"}`,
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
 * default); it scrolls beyond, with the header kept in view. A click on a cell outlines it and shows its column name and
 * full value in a popover beside it (below it where the right side has no room), with a button that copies the value
 * (numbers as JavaScript writes them); the labels are Japanese under a page or element whose lang is ja, English otherwise.
 * --queria-table-selected is the outline of the selected cell. The colors follow the page; --queria-table-border,
 * --queria-table-muted, --queria-table-header-background, --queria-table-stripe and --queria-table-link change them,
 * and --queria-table-font changes the font.
 */
export const renderTable = (
  el: HTMLElement,
  rows: Rows,
  { limit = 100, columns = Object.keys(rows[0] ?? {}), nullText = "", right = [] }: TableOptions = {},
): { finalize: () => void } => {
  const box = Object.assign(document.createElement("div"), { style: "overflow:auto;max-height:var(--queria-table-height,400px)" });
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
  // A click on a cell outlines it and shows its value in a popover beside it. Clicks on a link or that end a text
  // selection do nothing.
  let selected: HTMLTableCellElement | null = null;
  const select = (td: HTMLTableCellElement | null) => {
    selected?.style.removeProperty("outline");
    selected = td;
    td?.style.setProperty("outline", "2px solid var(--queria-table-selected,Highlight)");
    td?.style.setProperty("outline-offset", "-2px");
  };
  const popover = cellPopover(el.closest("[lang]")?.getAttribute("lang"), () => select(null));
  body.onclick = (e) => {
    const td = e.target instanceof HTMLTableCellElement ? e.target : null;
    const tr = td?.closest("tr");
    const column = td ? columns[td.cellIndex] : undefined;
    if (!td || !tr || column === undefined || getSelection()?.toString()) return;
    const v = rows[tr.sectionRowIndex]?.[column];
    if (v === null || v === undefined) return;
    select(td);
    popover.show(td, column, copyText(v));
  };
  box.append(table, popover.pop);
  const more = rows.length > limit ? [Object.assign(document.createElement("p"), { textContent: `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows`, style: `margin:4px 0 0;font:12px system-ui,sans-serif;${muted}` })] : [];
  el.append(box, ...more);
  return { finalize: () => [box, ...more].forEach((n) => n.remove()) };
};
