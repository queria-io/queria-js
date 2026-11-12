# queria

Query and visualize [Queria](https://queria.io/) open data in the browser. SQL runs in DuckDB WASM, charts are drawn with Vega-Lite, and the sources and licenses of the datasets are shown under each chart.

This package is in 0.x. Breaking changes can happen in any release until 1.0.

## Datasets

Declare every dataset the SQL reads by its fully qualified name (`handle/name`). In SQL, refer to it by the last part of the name, as in `e_stat.<schema>.<table>`. To read two datasets with the same name, give them aliases: `{ a: "alice/e_stat", b: "bob/e_stat" }`.

## HTML

```html
<script type="module">import "queria/elements/define";</script>

<queria-chart
  datasets="queria/e_stat"
  spec='{"mark": "line", "encoding": {"x": {"field": "year"}, "y": {"field": "population", "type": "quantitative"}}}'
  sql="SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
       WHERE area = '13224' AND cat01 = 'A1101' GROUP BY year ORDER BY year"></queria-chart>
```

## React

```tsx
import { Chart, QueriaProvider } from "queria/react";

<QueriaProvider datasets={["queria/e_stat"]}>
  <Chart sql={sql} spec={spec} />
</QueriaProvider>;
```

## JavaScript

```ts
import { connect, renderChart } from "queria";

const q = connect({ datasets: ["queria/e_stat"] });
await renderChart(el, spec, await q.sql(sql));
```

Charts need `vega`, `vega-lite`, `vega-embed` and `vega-interpreter`; maps need `maplibre-gl`. Install them only when you use them.

## License

MIT
