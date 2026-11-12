import type { EmbedOptions, Result, VisualizationSpec } from "vega-embed";
import { BASE, CATEGORIES } from "./palette.js";

/** A Vega-Lite spec. Its data is put in by the package. */
export type ChartSpec = VisualizationSpec | Record<string, unknown>;

export type Rows = readonly Record<string, unknown>[];

// Vega writes an id into every row it reads, so hand it copies: the caller's rows may be frozen or shared.
const copy = (rows: Rows): Record<string, unknown>[] => rows.map((r) => ({ ...r }));

const isRows = (d: Rows | Readonly<Record<string, Rows>>): d is Rows => Array.isArray(d);

const ownDatasets = (spec: ChartSpec): object => {
  const d: unknown = "datasets" in spec ? spec.datasets : undefined;
  return typeof d === "object" && d !== null ? d : {};
};

/**
 * Put the data into the spec. With rows, they become the data of a spec that has none.
 * With named rows, the spec (or its layers) picks them with data: { name }; rows named "" are the default data.
 */
export const withData = (spec: ChartSpec, data: Rows | Readonly<Record<string, Rows>>): Record<string, unknown> => {
  const named = isRows(data) ? { "": data } : data;
  const { "": main, ...rest } = named;
  // Vega-Lite takes width "container" only for single and layered views, and warns on the others.
  const composite = ["facet", "repeat", "concat", "hconcat", "vconcat"].some((k) => k in spec);
  return {
    ...(composite ? {} : { width: "container" }),
    ...spec,
    ...(main && !("data" in spec) ? { data: { values: copy(main) } } : {}),
    // The spec's own datasets stay; named rows are laid over them.
    ...(Object.keys(rest).length
      ? { datasets: { ...ownDatasets(spec), ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, copy(v)])) } }
      : {}),
  };
};

/**
 * The default look: a plain sans-serif font, no frame, grid lines only for numbers, the package's colors,
 * and a tooltip on every mark.
 */
export const chartTheme: Record<string, unknown> = {
  font: 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif',
  background: "transparent",
  view: { stroke: null },
  range: { category: CATEGORIES },
  mark: { color: BASE, tooltip: true },
  bar: { cornerRadiusEnd: 2 },
  line: { strokeWidth: 2 },
  point: { filled: true },
  axis: { grid: false, ticks: false, domainColor: "#a3a3a3", labelColor: "#525252", titleColor: "#404040", labelPadding: 6, titleFontWeight: 500 },
  // Year and category labels read across instead of being turned on their side.
  axisX: { labelAngle: 0 },
  axisQuantitative: { domain: false, grid: true, gridColor: "#e5e5e5" },
  legend: { labelColor: "#525252", titleColor: "#404040", titleFontWeight: 500 },
  title: { anchor: "start", fontSize: 14, fontWeight: 600, color: "#171717" },
};

export type ChartOptions = {
  /** Vega-Lite config. Its top-level keys replace those of chartTheme, and the spec's own config is merged over it. */
  config?: Record<string, unknown>;
  /** Export and source menu. Hidden by default. */
  actions?: EmbedOptions["actions"];
  /** Labels of the menu. */
  i18n?: EmbedOptions["i18n"];
  tooltipTheme?: "light" | "dark";
  /** By default svg, and canvas when there are more than 5,000 rows in all. */
  renderer?: "svg" | "canvas";
};

const CANVAS_ABOVE = 5000;

const rowCount = (data: Rows | Readonly<Record<string, Rows>>): number =>
  isRows(data) ? data.length : Object.values(data).reduce((n, rows) => n + rows.length, 0);

/**
 * Draw a Vega-Lite chart. vega-embed and vega-interpreter are loaded on first use. Expressions are run by the
 * interpreter, so charts draw on pages whose Content Security Policy has no unsafe-eval.
 * Returns the Vega view and a function that removes the chart.
 * Sources and licenses are not drawn here; the elements and React components add them under the chart.
 */
export const renderChart = async (
  el: HTMLElement,
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  { config, actions = false, i18n, tooltipTheme, renderer }: ChartOptions = {},
): Promise<Pick<Result, "view" | "finalize">> => {
  const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
  const { view, finalize } = await embed(el, withData(spec, data) as VisualizationSpec, {
    // Read the spec as Vega-Lite even when its $schema says Vega
    mode: "vega-lite",
    ast: true,
    expr: expressionInterpreter,
    renderer: renderer ?? (rowCount(data) > CANVAS_ABOVE ? "canvas" : "svg"),
    actions,
    ...(i18n ? { i18n } : {}),
    config: { ...chartTheme, ...config },
    ...(tooltipTheme ? { tooltip: { theme: tooltipTheme } } : {}),
  });
  return { view, finalize };
};
