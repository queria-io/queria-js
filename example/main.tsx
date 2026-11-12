import { createRoot } from "react-dom/client";
import "../src/elements/define.js";
import { Chart, QueriaProvider } from "../src/react/index.js";

const sql = `
SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
WHERE area = '13224' AND cat01 = 'A1101' AND value IS NOT NULL
GROUP BY year ORDER BY year`;

const spec = {
  mark: "line",
  height: 160,
  encoding: { x: { field: "year", type: "ordinal" }, y: { field: "population", type: "quantitative" } },
} as const;

createRoot(document.getElementById("root")!).render(
  <QueriaProvider datasets={["queria/e_stat"]} apiUrl="">
    <Chart sql={sql} spec={spec} />
  </QueriaProvider>,
);
