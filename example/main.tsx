import { createRoot } from "react-dom/client";
import { LineChart, PoweredBy, QueriaProvider, useQuery } from "../src/react/index.js";

const sql = `
SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
WHERE area = '13224' AND cat01 = 'A1101' AND value IS NOT NULL
GROUP BY year ORDER BY year`;

const Population = () => {
  const state = useQuery<{ year: number; population: number }>(sql);
  if (state.status === "loading") return <p>Loading…</p>;
  if (state.status === "error") return <p>{String(state.error)}</p>;
  return <LineChart series={[{ label: "Tama", points: state.rows.map((r) => [r.year, r.population]) }]} width={480} height={160} />;
};

createRoot(document.getElementById("root")!).render(
  <QueriaProvider>
    <h1>Population of Tama City</h1>
    <Population />
    <PoweredBy />
  </QueriaProvider>,
);
