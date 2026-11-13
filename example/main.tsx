import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { createRoot } from "react-dom/client";
import "../src/elements/define.js";
import { Chart, DataMap, Kpi, QueriaProvider, Table } from "../src/react/index.js";

// Until Queria's map style is published, read the boundary tiles as PMTiles (see style.json).
maplibregl.addProtocol("pmtiles", new Protocol().tile);

const tokyo = `
SELECT area AS lg_code, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
WHERE area LIKE '13%' AND area < '13300' AND area <> '13100' AND year = 2020 AND cat01 = 'A1101' AND value IS NOT NULL
GROUP BY area`;

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
    <Kpi sql={sql} value="population" label="人口" unit="人" />
    <Chart sql={sql} spec={spec} />
    <Table sql={sql} />
    <DataMap sql={tokyo} layer={{ area: "city", code: "lg_code", color: "population", label: "lg_code" }} style="/style.json" />
  </QueriaProvider>,
);
