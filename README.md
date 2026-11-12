# queria

Query and visualize [Queria](https://queria.io/) open data in the browser. SQL runs in DuckDB WASM, charts are drawn with Vega-Lite, and the sources and licenses of the datasets are shown under each chart.

This package is in 0.x. Breaking changes can happen in any release until 1.0.

## Datasets

Declare every dataset the SQL reads by its fully qualified name (`handle/name`). In SQL, refer to it by the last part of the name, as in `e_stat.<schema>.<table>`. To read two datasets with the same name, give them aliases: `{ a: "alice/e_stat", b: "bob/e_stat" }`.

## HTML without a build step

Load the elements from jsDelivr. Vega-Lite, MapLibre and DuckDB WASM are loaded from the same CDN when a chart or map first needs them, so a single HTML file is enough.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/queria@0.1/elements/define/+esm"></script>

<queria-chart
  datasets="queria/e_stat"
  spec='{"mark": "bar", "encoding": {"x": {"field": "year", "type": "ordinal"}, "y": {"field": "population", "type": "quantitative"}}}'
  sql="SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
       WHERE area = '13224' AND cat01 = 'A1101' GROUP BY year ORDER BY year"></queria-chart>
```

Charts are gray by default. To make a point, color values purple with `highlight`: a name on an axis (`highlight="世田谷区"`), a series of a color field, or a JSON array of them. Dates match their day (`"2020-04-01"`). When no value is found, the chart keeps its colors. In JavaScript, `renderChart(el, spec, rows, { highlight })` returns `highlighted`, which says whether a value was found. Pages that load their own vega-embed pass it with `{ vega: { embed, expressionInterpreter } }`.

Under each chart, map and table that ran SQL, a folded "SQL" section shows the query and links to queria.io, where readers can rerun and change it without signing in, and save it as a report. Charts open as charts. In JavaScript, `await q.shareUrl(sql, spec)` returns the link.

Write each chart, map or table as one SQL statement, with its steps as `WITH` clauses. The link then carries everything needed to reproduce it.

In a module script, import the functions from `https://cdn.jsdelivr.net/npm/queria@0.1/+esm`.

## HTML with a bundler

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

SQL that calls `ST_*` functions loads the DuckDB spatial extension on first use.

To read datasets that are not public, pass a data token (`qd_...`) or a function that returns one: `connect({ datasets, token })`. The token is sent to the Queria API and to the hosts of the declared datasets. DuckDB is shared by the page, so use one token per page.

## Tables

```html
<queria-table datasets="queria/e_stat" sql="SELECT ..."></queria-table>
```

Shows up to 100 rows (`limit` changes it). In JavaScript, `renderTable(el, rows)`. The height is the CSS variable `--queria-table-height` (400px by default).

## Maps

```html
<queria-map datasets="queria/e_stat" sql="SELECT area AS lg_code, value AS population FROM ..."
  layer='{"area": "city", "code": "lg_code", "color": "population", "label": "lg_code"}'></queria-map>
```

`layer` puts rows on the map by area code (`area` is `prefecture`, `city` or `small_area`, `code` is the column) or by position (`lng` and `lat` columns). `color` colors by a column: numbers from light to dark, other values one color each, with a legend (`"legend": false` hides it). `label` names a row on hover or tap. In React, use `<DataMap sql={sql} layer={layer} />`; in JavaScript, `renderMap(el, layer, rows)`. The package links maplibre-gl's CSS unless the page already does. The map height is the CSS variable `--queria-map-height` (400px by default).

With a bundler, charts need `vega`, `vega-lite`, `vega-embed` and `vega-interpreter`; maps need `maplibre-gl`. Install them only when you use them.

## Content Security Policy

Pages with a Content Security Policy, such as apps inside AI chats, must allow these sources. When one is missing, the error names it.

- `script-src`: `https://cdn.jsdelivr.net` (when loaded from jsDelivr) and `'wasm-unsafe-eval'`
- `worker-src`: `blob:`
- `connect-src`: `https://api.queria.io`, `https://data.queria.io` (the declared datasets), `https://assets.queria.io` (DuckDB WASM and maps), `https://extensions.duckdb.org`, `https://cdn.jsdelivr.net`
- `style-src`: `https://cdn.jsdelivr.net` (maplibre-gl's CSS, for maps)
- `img-src`: `data:` and `blob:` (for maps)

Where the page cannot reach these hosts at all, get the rows elsewhere (for example from Queria's MCP server) and draw them without SQL: `renderChart(el, spec, rows)`, `renderTable(el, rows)`, or `<queria-chart rows='[...]'>`. Declare the datasets the rows came from in `datasets` so their sources are shown.

## License

MIT
