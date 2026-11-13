import type { Annotation } from "../render/annotate.js";
import { type ChartSpec, renderChart, type Tone } from "../render/chart.js";
import { type Data, Frame, useDraw, useResult } from "./result.js";

type Props = { spec: ChartSpec; className?: string; theme?: Tone; highlight?: unknown; annotations?: readonly Annotation[] } & Data;

/** A Vega-Lite chart of the SQL result (or of `rows`), followed by the sources of the datasets. */
export const Chart = ({ spec, className = "queria-chart", theme, highlight, annotations, ...data }: Props) => {
  const result = useResult(data, spec);
  const [ref, error] = useDraw(result.values, (el, rows) => renderChart(el, spec, rows, { theme, highlight, annotations }), [
    JSON.stringify(spec),
    theme,
    JSON.stringify(highlight),
    JSON.stringify(annotations),
  ]);
  return <Frame className={className} result={result} error={error}><div ref={ref} /></Frame>;
};
