import type { VisualizationSpec } from "vega-embed";

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

/**
 * Draw a Vega-Lite chart. vega-embed is loaded on first use. Returns a function that removes the chart.
 * Sources and licenses are not drawn here; the elements and React components add them under the chart.
 */
export const renderChart = async (
  el: HTMLElement,
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
): Promise<() => void> => {
  const { default: embed } = await import("vega-embed");
  const { finalize } = await embed(el, withData(spec, data) as VisualizationSpec, { actions: false });
  return finalize;
};
