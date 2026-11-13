import { connect, parseDatasets } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import type { Annotation } from "../render/annotate.js";
import { renderChart } from "../render/chart.js";
import { renderMap } from "../render/data-map.js";
import { esc } from "../render/escape.js";
import { renderKpi } from "../render/kpi.js";
import { renderTable } from "../render/table.js";
import { poweredByHtml } from "../render/poweredBy.js";

/** The theme attribute: light, dark, or unset to follow the page's text color. */
const themeOf = (value: string | null): "light" | "dark" | undefined => (value === "light" || value === "dark" ? value : undefined);

/** The highlight attribute: one value, or a JSON array of values. */
const highlightOf = (value: string | null): unknown =>
  value === null || value === "" ? undefined : value.trimStart().startsWith("[") ? JSON.parse(value) : value;

/** The annotations attribute: a JSON array of { at, text, dx, dy }. */
const annotationsOf = (value: string | null): Annotation[] | undefined => (value ? [JSON.parse(value)].flat() : undefined);

/** A line of text in place of the chart or map. Errors keep their line breaks. */
const note = (text: string): string =>
  `<p class="queria-note" style="margin:0;white-space:pre-wrap;font:13px/1.5 system-ui,sans-serif;color:#737373">${esc(text)}</p>`;

type Draw = (box: HTMLElement, rows: Record<string, unknown>[], attr: (name: string) => string | null) => Promise<{ finalize: () => void }>;

/**
 * An element that runs its `sql` (or reads `rows` as JSON), then draws the rows into `box` and shows the sources of
 * `datasets` under it. `need` is the attribute that says how to draw, if any; nothing is drawn without it.
 */
const dataElement = (need: string | null, extra: readonly string[], box: string, draw: Draw) =>
  class extends HTMLElement {
    static observedAttributes = ["datasets", "sql", "rows", "api-url", ...(need ? [need] : []), ...extra];
    #run = 0;
    #pending = false;
    #finalize: (() => void) | null = null;

    connectedCallback() {
      this.#schedule();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.#schedule();
    }

    disconnectedCallback() {
      this.#run++;
      this.#clear();
    }

    /** Draw once per task: an upgrade calls attributeChangedCallback for every attribute, then connectedCallback. */
    #schedule() {
      if (this.#pending) return;
      this.#pending = true;
      queueMicrotask(() => {
        this.#pending = false;
        if (this.isConnected) this.#draw();
      });
    }

    #clear() {
      this.#finalize?.();
      this.#finalize = null;
    }

    async #draw() {
      const attr = (name: string) => this.getAttribute(name);
      const [sql, rows] = [attr("sql"), attr("rows")];
      if ((need && !attr(need)) || (!rows && !sql)) return;
      const run = ++this.#run;
      this.#clear();
      this.innerHTML = note("Loading…");
      try {
        const conn = connect({ datasets: parseDatasets(attr("datasets") ?? ""), apiUrl: attr("api-url") ?? undefined });
        // With rows, the page ran the SQL itself; show every declared dataset as a source.
        const [data, sources] = await Promise.all([sql ? conn.sql(sql) : JSON.parse(rows ?? "[]"), conn.sources(sql ?? undefined)]);
        if (run !== this.#run) return;
        if (data.length === 0) {
          this.innerHTML = note("The SQL returned no rows.");
          return;
        }
        const url = sql ? await conn.shareUrl(sql, need === "spec" ? JSON.parse(attr("spec") ?? "{}") : undefined) : null;
        if (run !== this.#run) return;
        this.innerHTML = `${box}${attributionHtml(sources, sql && url ? { sql, url } : undefined)}`;
        const { finalize } = await draw(this.firstElementChild as HTMLElement, data, attr);
        if (run === this.#run) this.#finalize = finalize;
        else finalize();
      } catch (e) {
        if (run === this.#run) this.innerHTML = note(e instanceof Error ? e.message : String(e));
      }
    }
  };

/**
 * <queria-chart datasets="queria/e_stat" sql="..." spec='{"mark": "line", ...}'>
 * Runs the SQL and draws the rows with the Vega-Lite spec, followed by the sources of the datasets.
 * Instead of sql, `rows` takes the rows as JSON, for pages that run the SQL at build time. Declare the datasets the
 * rows came from in `datasets` so their sources are shown.
 * `api-url` replaces the Queria API, for example with a staging host. `theme` is light or dark; by default the chart
 * is dark when the element's text color is light. `highlight` colors one value (or a JSON array of values) purple.
 * `annotations` adds notes with arrows, as a JSON array of { at, text, dx, dy }.
 */
export class QueriaChart extends dataElement("spec", ["theme", "highlight", "annotations"], "<div></div>", (box, rows, attr) =>
  renderChart(box, JSON.parse(attr("spec") ?? "{}"), rows, {
    theme: themeOf(attr("theme")),
    highlight: highlightOf(attr("highlight")),
    annotations: annotationsOf(attr("annotations")),
  }),
) {}

/**
 * <queria-map datasets="queria/e_stat" sql="..." layer='{"area": "city", "code": "lg_code", "color": "population"}'>
 * Runs the SQL and puts the rows on a map by area code or by lng/lat, followed by the sources of the datasets.
 * `rows`, `api-url` work as on <queria-chart>. `theme` works as on <queria-chart>; `map-style` takes another MapLibre style URL.
 * `cooperative-gestures` keeps the wheel and one finger for scrolling the page.
 * The map height is the CSS variable --queria-map-height (400px by default).
 */
export class QueriaMap extends dataElement("layer", ["theme", "map-style", "cooperative-gestures"], '<div style="height:var(--queria-map-height,400px)"></div>', (box, rows, attr) => {
  const style = attr("map-style");
  return renderMap(box, JSON.parse(attr("layer") ?? "{}"), rows, {
    theme: themeOf(attr("theme")),
    cooperativeGestures: attr("cooperative-gestures") !== null,
    ...(style ? { style } : {}),
  });
}) {}

/**
 * <queria-table datasets="queria/e_stat" sql="...">
 * Runs the SQL and shows the rows as a table, followed by the sources. `rows`, `api-url` work as on <queria-chart>;
 * `limit` sets the rows shown (100 by default).
 */
export class QueriaTable extends dataElement(null, ["limit"], "<div></div>", async (box, rows, attr) =>
  renderTable(box, rows, { limit: Number(attr("limit") ?? 100) || 100 }),
) {}

/**
 * <queria-kpi datasets="queria/e_stat" sql="..." value="population" label="人口" unit="人">
 * Runs the SQL and shows the `value` column of the last row large, with its change from the row before it, followed by
 * the sources. `compare` names a column of the last row to compare with instead; `compare-label` replaces "前年比";
 * `compact="false"` writes the number in full. `rows`, `api-url` work as on <queria-chart>.
 */
export class QueriaKpi extends dataElement("value", ["compare", "label", "unit", "compare-label", "compact"], "<div></div>", async (box, rows, attr) =>
  renderKpi(box, rows, {
    value: attr("value") ?? "",
    compare: attr("compare") ?? undefined,
    label: attr("label") ?? undefined,
    unit: attr("unit") ?? undefined,
    compareLabel: attr("compare-label") ?? undefined,
    compact: attr("compact") !== "false",
  }),
) {}

/** <queria-powered-by> */
export class QueriaPoweredBy extends HTMLElement {
  connectedCallback() {
    this.innerHTML = poweredByHtml();
  }
}

const elements = { "queria-chart": QueriaChart, "queria-map": QueriaMap, "queria-table": QueriaTable, "queria-kpi": QueriaKpi, "queria-powered-by": QueriaPoweredBy };

/** Register the custom elements. Safe to call more than once. */
export const defineElements = (): void =>
  Object.entries(elements).forEach(([name, cls]) => customElements.get(name) ?? customElements.define(name, cls));

declare global {
  interface HTMLElementTagNameMap {
    "queria-chart": QueriaChart;
    "queria-map": QueriaMap;
    "queria-table": QueriaTable;
    "queria-kpi": QueriaKpi;
    "queria-powered-by": QueriaPoweredBy;
  }
}
