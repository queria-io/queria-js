import type { Rows } from "./chart.js";
import { esc } from "./escape.js";

export type KpiOptions = {
  /** The column of the number shown large. It is read from the last row. */
  value: string;
  /**
   * The column of the number to compare with, read from the last row. Without it, the value of the row before the
   * last is compared, so rows ordered by year give the change from the year before.
   */
  compare?: string;
  /** Text above the number, such as "人口". */
  label?: string;
  /** Text after the number, such as "人". With "%", the change is written in points (pt) instead of as a rate. */
  unit?: string;
  /** Text before the change. "前年比" on Japanese pages and "vs previous year" elsewhere by default. */
  compareLabel?: string;
  /** Write 10,000 and above as 万 and 億 (K, M and B elsewhere). True by default. */
  compact?: boolean;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "bigint" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

/** The number and the one it is compared with. Either is undefined when it is missing or not a number. */
export const kpiValues = (rows: Rows, { value, compare }: Pick<KpiOptions, "value" | "compare">): { current?: number; previous?: number } => {
  const last = rows.at(-1);
  const before = compare === undefined ? rows.at(-2)?.[value] : last?.[compare];
  return { current: num(last?.[value]), previous: num(before) };
};

/** A number for the reader: 万 and 億 on Japanese pages (K, M, B elsewhere) from 10,000 when compact, else in full. */
export const kpiNumber = (v: number, lang: string, compact = true): string =>
  compact && Math.abs(v) >= 1e4
    ? new Intl.NumberFormat(lang, { notation: "compact", maximumSignificantDigits: 4 }).format(v)
    : v.toLocaleString(lang, { maximumFractionDigits: 2 });

/** The change as a rate with its sign, such as "+1.2%". Undefined when the number compared with is 0. */
export const changeRate = (current: number, previous: number): string | undefined =>
  previous === 0 ? undefined : `${current >= previous ? "+" : "−"}${((Math.abs(current - previous) / Math.abs(previous)) * 100).toFixed(1)}%`;

const signed = (d: number, lang: string, compact: boolean): string => `${d >= 0 ? "+" : "−"}${kpiNumber(Math.abs(d), lang, compact)}`;

/**
 * Draw one number large, with its change from another number under it, such as the population and the change from the
 * year before. Text takes the page's font and color; the change is not colored, as a rise is not always good.
 */
export const renderKpi = (el: HTMLElement, rows: Rows, options: KpiOptions): { finalize: () => void } => {
  const { label, unit = "", compact = true } = options;
  const lang = el.closest("[lang]")?.getAttribute("lang") ?? "ja";
  const ja = lang.startsWith("ja");
  const { current, previous } = kpiValues(rows, options);
  const head = label ? `<div style="font-size:13px;opacity:.7">${esc(label)}</div>` : "";
  const big =
    current === undefined
      ? '<div style="font-size:32px;font-weight:600;line-height:1.2">–</div>'
      : `<div title="${esc(current.toLocaleString(lang) + unit)}" style="font-size:32px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums">` +
        `${esc(kpiNumber(current, lang, compact))}<span style="font-size:15px;font-weight:400;margin-left:2px">${esc(unit)}</span></div>`;
  // A number in % changes by points; a rate of a rate would be read as points.
  const percent = unit === "%";
  const rate = current !== undefined && previous !== undefined && !percent ? changeRate(current, previous) : undefined;
  const diff = current !== undefined && previous !== undefined ? signed(current - previous, lang, compact) + (percent ? "pt" : unit) : undefined;
  const change = diff
    ? `<div style="font-size:13px;opacity:.7;font-variant-numeric:tabular-nums">${esc(options.compareLabel ?? (ja ? "前年比" : "vs previous year"))} ` +
      `<span style="white-space:nowrap">${esc(rate ? `${rate} (${diff})` : diff)}</span></div>`
    : "";
  const box = Object.assign(document.createElement("div"), { className: "queria-kpi-value" });
  box.innerHTML = head + big + change;
  el.append(box);
  return { finalize: () => box.remove() };
};
