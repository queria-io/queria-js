import { useMemo } from "react";
import { type LineChartOptions, lineChartSvg, type Series } from "../render/lineChart.js";

/** A line chart of values by year, drawn by the same function as <queria-line-chart>. */
export const LineChart = ({ series, ...options }: { series: Series[] } & LineChartOptions) => {
  const html = useMemo(() => lineChartSvg(series, options), [series, options.width, options.height]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};
