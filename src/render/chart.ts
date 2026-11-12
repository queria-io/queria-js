import type { EmbedOptions, Result, VisualizationSpec } from "vega-embed";

/** A Vega-Lite spec. Its data is put in by the package. */
export type ChartSpec = VisualizationSpec | Record<string, unknown>;

export type Rows = readonly Record<string, unknown>[];

// Vega writes an id into every row it reads, so hand it copies: the caller's rows may be frozen or shared.
const copy = (rows: Rows): Record<string, unknown>[] => rows.map((r) => ({ ...r }));

const isRows = (d: Rows | Readonly<Record<string, Rows>>): d is Rows => Array.isArray(d);

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
    ...(Object.keys(rest).length ? { datasets: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, copy(v)])) } : {}),
  };
};

export type ChartOptions = {
  /** Vega-Lite config, such as a theme. The spec's own config is merged over it. */
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
    ...(config ? { config } : {}),
    ...(tooltipTheme ? { tooltip: { theme: tooltipTheme } } : {}),
  });
  return { view, finalize };
};
