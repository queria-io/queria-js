import type { Annotation } from "../render/annotate.js";
import { type ChartSpec, renderChart, type Tone } from "../render/chart.js";
import { imageOptionsOf, saveChartPng } from "../render/export.js";
import { type Data, Frame, useDraw, useResult } from "./result.js";

type Props = {
  spec: ChartSpec;
  className?: string;
  theme?: Tone;
  highlight?: unknown;
  annotations?: readonly Annotation[];
  /** Show a "Save image" button that saves the chart as a 1200 × 630 PNG with the sources and the logo. */
  saveImage?: boolean;
} & Data;

/** A Vega-Lite chart of the SQL result (or of `rows`), followed by the sources of the datasets. */
export const Chart = ({ spec, className = "queria-chart", theme, highlight, annotations, saveImage = false, ...data }: Props) => {
  const result = useResult(data, spec);
  const [ref, error] = useDraw(result.values, (el, rows) => renderChart(el, spec, rows, { theme, highlight, annotations }), [
    JSON.stringify(spec),
    theme,
    JSON.stringify(highlight),
    JSON.stringify(annotations),
  ]);
  const { values, sources } = result;
  const save = async () => {
    if (ref.current && values) await saveChartPng(spec, values, imageOptionsOf(ref.current, { theme, highlight, annotations, sources }));
  };
  return (
    <Frame className={className} result={result} error={error} onSaveImage={saveImage ? save : undefined}>
      <div ref={ref} />
    </Frame>
  );
};
