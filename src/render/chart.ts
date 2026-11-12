import type { VisualizationSpec } from "vega-embed";

/** A Vega-Lite spec without data; the rows are put in by the package. */
export type ChartSpec = Exclude<VisualizationSpec, { data: unknown }> | Record<string, unknown>;

/** Draw a Vega-Lite chart of the rows. vega-embed is loaded on first use. Returns a function that removes the chart. */
export const renderChart = async (
  el: HTMLElement,
  spec: ChartSpec,
  rows: readonly Record<string, unknown>[],
): Promise<() => void> => {
  const { default: embed } = await import("vega-embed");
  const full = { width: "container", ...spec, data: { values: rows } } as VisualizationSpec;
  const { finalize } = await embed(el, full, { actions: false });
  return finalize;
};
