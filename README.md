# queria

Query and visualize [Queria](https://queria.io/) open data in the browser. SQL runs in DuckDB WASM; datasets referenced as `<dataset>.<schema>.<table>` are attached on first use.

## HTML

```html
<script type="module">import "queria/elements/define";</script>

<queria-line-chart x="year" y="population"
  sql="SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
       WHERE area = '13224' AND cat01 = 'A1101' GROUP BY year ORDER BY year"></queria-line-chart>
```

## React

```tsx
import { LineChart, useQuery } from "queria/react";

const state = useQuery<{ year: number; population: number }>(sql);
```

## JavaScript

```ts
import { createQueria, renderLineChart, toSeries } from "queria";

const rows = await createQueria().query(sql);
renderLineChart(el, toSeries(rows, { x: "year", y: "population" }));
```

Line colors come from the CSS custom properties `--viz-0`, `--viz-1`, …

## License

MIT
