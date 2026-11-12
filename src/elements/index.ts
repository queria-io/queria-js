import { connect, parseDatasets } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { renderChart } from "../render/chart.js";
import { renderMap } from "../render/data-map.js";
import { esc } from "../render/escape.js";
import { poweredByHtml } from "../render/poweredBy.js";

/** A line of text in place of the chart or map. Errors keep their line breaks. */
const note = (text: string): string =>
  `<p class="queria-note" style="margin:0;white-space:pre-wrap;font:13px/1.5 system-ui,sans-serif;color:#737373">${esc(text)}</p>`;

type Draw = (box: HTMLElement, rows: Record<string, unknown>[], attr: (name: string) => string | null) => Promise<{ finalize: () => void }>;

/**
 * An element that runs its `sql` (or reads `rows` as JSON), then draws the rows into `box` and shows the sources of
 * `datasets` under it. `need` is the attribute that says how to draw; nothing is drawn without it.
 */
const dataElement = (need: string, extra: readonly string[], box: string, draw: Draw) =>
  class extends HTMLElement {
    static observedAttributes = ["datasets", "sql", "rows", "api-url", need, ...extra];
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
      if (!attr(need) || (!rows && !sql)) return;
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
        this.innerHTML = `${box}${attributionHtml(sources)}`;
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
 * `api-url` replaces the Queria API, for example with a staging host.
 */
export class QueriaChart extends dataElement("spec", [], "<div></div>", (box, rows, attr) =>
  renderChart(box, JSON.parse(attr("spec") ?? "{}"), rows),
) {}

/**
 * <queria-map datasets="queria/e_stat" sql="..." layer='{"area": "city", "code": "lg_code", "color": "population"}'>
 * Runs the SQL and puts the rows on a map by area code or by lng/lat, followed by the sources of the datasets.
 * `rows`, `api-url` work as on <queria-chart>. `theme` is light or dark; `map-style` takes another MapLibre style URL.
 * The map height is the CSS variable --queria-map-height (400px by default).
 */
export class QueriaMap extends dataElement("layer", ["theme", "map-style"], '<div style="height:var(--queria-map-height,400px)"></div>', (box, rows, attr) => {
  const style = attr("map-style");
  return renderMap(box, JSON.parse(attr("layer") ?? "{}"), rows, { theme: attr("theme") === "dark" ? "dark" : "light", ...(style ? { style } : {}) });
}) {}

/** <queria-powered-by> */
export class QueriaPoweredBy extends HTMLElement {
  connectedCallback() {
    this.innerHTML = poweredByHtml();
  }
}

const elements = { "queria-chart": QueriaChart, "queria-map": QueriaMap, "queria-powered-by": QueriaPoweredBy };

/** Register the custom elements. Safe to call more than once. */
export const defineElements = (): void =>
  Object.entries(elements).forEach(([name, cls]) => customElements.get(name) ?? customElements.define(name, cls));

declare global {
  interface HTMLElementTagNameMap {
    "queria-chart": QueriaChart;
    "queria-map": QueriaMap;
    "queria-powered-by": QueriaPoweredBy;
  }
}
