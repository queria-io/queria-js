import { esc } from "./escape.js";

export type Series = { label: string; points: [number, number][] };
export type LineChartOptions = { width?: number; height?: number };

const compact = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
const color = (i: number) => `var(--viz-${i}, currentColor)`;

/** SVG markup of a line chart of values by year. Colors come from CSS custom properties --viz-0, --viz-1, ... */
export const lineChartSvg = (series: Series[], { width = 280, height = 96 }: LineChartOptions = {}): string => {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return "";
  const pad = { left: 44, right: 8, top: 8, bottom: 18 };
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  // The y axis always includes 0 and extends below it for negative values.
  const [top, bottom] = [Math.max(0, ...ys), Math.min(0, ...ys)];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), bottom * 1.05, top * 1.05];
  const x = (v: number) => pad.left + ((v - x0) / Math.max(x1 - x0, 1)) * (width - pad.left - pad.right);
  const y = (v: number) => height - pad.bottom - ((v - y0) / (y1 - y0 || 1)) * (height - pad.top - pad.bottom);
  const ticks = [...new Set([top, 0, bottom])].map(
    (v) =>
      `<text x="${pad.left - 4}" y="${v > 0 ? y(v) + 4 : y(v)}" text-anchor="end">${v === 0 ? "0" : esc(compact.format(v))}</text>`,
  );
  const lines = series.map(
    (s, i) =>
      `<g stroke="${color(i)}" fill="${color(i)}">` +
      `<polyline fill="none" stroke-width="1.5" points="${s.points.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")}"/>` +
      s.points
        .map(([a, b]) => `<circle cx="${x(a)}" cy="${y(b)}" r="2"><title>${esc(`${s.label} ${a}: ${b.toLocaleString()}`)}</title></circle>`)
        .join("") +
      "</g>",
  );
  const legend =
    series.length > 1
      ? `<figcaption>${series.map((s, i) => `<span style="color:${color(i)}">● ${esc(s.label)}</span>`).join(" ")}</figcaption>`
      : "";
  return (
    `<figure class="viz-line" style="margin:0"><svg viewBox="0 0 ${width} ${height}" role="img" font-size="10" fill="currentColor">` +
    ticks.join("") +
    `<text x="${x(x0)}" y="${height - 4}">${x0}</text>` +
    `<text x="${x(x1)}" y="${height - 4}" text-anchor="end">${x1}</text>` +
    `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" stroke-opacity="0.3"/>` +
    lines.join("") +
    `</svg>${legend}</figure>`
  );
};

/** Draw a line chart into an element, replacing its contents. */
export const renderLineChart = (el: Element, series: Series[], options?: LineChartOptions): void => {
  el.innerHTML = lineChartSvg(series, options);
};

/** Turn query rows into series sorted by x: one per distinct value of `by`, or a single series labeled `label`. */
export const toSeries = (
  rows: Record<string, unknown>[],
  { x, y, by, label = y }: { x: string; y: string; by?: string; label?: string },
): Series[] => {
  const groups = rows
    .filter((r) => r[x] != null && r[y] != null)
    .reduce((m, r) => {
      const key = by ? String(r[by]) : label;
      return m.set(key, [...(m.get(key) ?? []), [Number(r[x]), Number(r[y])]]);
    }, new Map<string, [number, number][]>());
  // Rows without ORDER BY come in any order; a polyline needs its points in x order.
  return [...groups].map(([name, points]) => ({ label: name, points: points.sort((a, b) => a[0] - b[0]) }));
};
