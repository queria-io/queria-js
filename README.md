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

Charts are gray by default. To make a point, color values purple with `highlight`: a name on an axis (`highlight="世田谷区"`), a series of a color field, or a JSON array of them. Dates match their day (`"2020-04-01"`). When no value is found, the chart keeps its colors. In JavaScript, `renderChart(el, spec, rows, { highlight })` returns `highlighted`, which says whether a value was found. To start loading the chart code while the data loads, call `preloadChart()`.

To explain a point, add a short note with an arrow: `annotations='[{"at": "2020", "text": "Station opened"}]'`. `at` picks the row the arrow points to, by a value of the x, y or color field, or by several values that must all match (`["2020", "Setagaya"]`). The note is placed 20px right and 30px above the point; `dx` and `dy` move it (in pixels). Notes work on single and layered charts. Notes whose row is not found are left out, and `renderChart` returns `annotated`, the number of notes drawn. In React and JavaScript, pass `annotations` the same way.

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

## Images

To post a chart on social media, make it a PNG image: `chartPng(spec, rows, { sources, highlight, annotations })` returns a 1200 × 630 PNG blob in Queria's look, on a solid background, with the sources and the Queria logo under the chart. Pass the datasets from `await q.sources(sql)` as `sources`. `theme` picks light (the default) or dark colors; `width` and `height` set the size in CSS pixels (600 × 315 by default) and `scale` the pixels per CSS pixel (2 by default).

```ts
import { chartPng, connect } from "queria";

const q = connect({ datasets: ["queria/e_stat"] });
const blob = await chartPng(spec, await q.sql(sql), { sources: await q.sources(sql) });
Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "chart.png" }).click();
```

`chartSvg` takes the same options and returns the image as SVG text. It also runs in Node, for images made at build time or on a server. The image uses the fonts installed where it is drawn.

## Tables

```html
<queria-table datasets="queria/e_stat" sql="SELECT ..."></queria-table>
```

Shows up to 100 rows (`limit` changes it). In React, `<Table sql={sql} />`; in JavaScript, `renderTable(el, rows)`. The height is the CSS variable `--queria-table-height` (400px by default).

## Numbers

```html
<queria-kpi datasets="queria/e_stat" value="population" label="人口" unit="人"
  sql="SELECT year, any_value(value) AS population FROM e_stat.ssds.a_municipal_population
       WHERE area = '13224' AND cat01 = 'A1101' GROUP BY year ORDER BY year"></queria-kpi>
```

Shows the `value` column of the last row large, with its change from the row before it ("前年比 +0.9% (+1.3万人)"). To compare with another column of the last row, name it in `compare`. Numbers from 10,000 are written with 万 and 億 on Japanese pages and K, M, B elsewhere; `compact="false"` writes them in full. With `unit="%"`, the change is in points. `compare-label` replaces "前年比". In React, `<Kpi sql={sql} value="population" />`; in JavaScript, `renderKpi(el, rows, { value })`.

## Maps

```html
<queria-map datasets="queria/e_stat" sql="SELECT area AS lg_code, value AS population FROM ..."
  layer='{"area": "city", "code": "lg_code", "color": "population", "label": "lg_code"}'></queria-map>
```

`layer` puts rows on the map by area code (`area` is `prefecture`, `city` or `small_area`, `code` is the column), by position (`lng` and `lat` columns) or by GeoJSON geometries (`geometry` is a column of GeoJSON text or objects, such as `ST_AsGeoJSON(geom)`). `color` colors by a column: numbers from light to dark, other values one color each, with a legend (`"legend": false` hides it). `label` names a row on hover or tap. In React, use `<DataMap sql={sql} layer={layer} />`; in JavaScript, `renderMap(el, layer, rows)`, which returns the MapLibre map: listen to the layer `ROWS_LAYER` for clicks on the rows (a feature has the area `code`, or the `row` index for geometries). The package links maplibre-gl's CSS unless the page already has it. The map height is the CSS variable `--queria-map-height` (400px by default).

With a bundler, maps need `maplibre-gl`; install it only when you use maps. Charts need nothing more: their code is loaded on first use.

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
