import { connect, parseDatasets } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { renderChart } from "../render/chart.js";
import { renderMap } from "../render/data-map.js";
import { esc } from "../render/escape.js";
import { poweredByHtml } from "../render/poweredBy.js";

/**
 * <queria-chart datasets="queria/e_stat" sql="..." spec='{"mark": "line", ...}'>
 * Runs the SQL and draws the rows with the Vega-Lite spec, followed by the sources of the datasets.
 * Instead of sql, `rows` takes the rows as JSON, for pages that run the SQL at build time. Declare the datasets the
 * rows came from in `datasets` so their sources are shown.
 * `api-url` replaces the Queria API, for example with a staging host.
 */
export class QueriaChart extends HTMLElement {
  static observedAttributes = ["datasets", "sql", "spec", "rows", "api-url"];
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
    const [datasets, sql, spec, rows] = ["datasets", "sql", "spec", "rows"].map((a) => this.getAttribute(a));
    if (!spec || (!rows && !sql)) return;
    const run = ++this.#run;
    this.#clear();
    this.innerHTML = '<p class="queria-note">Loading…</p>';
    try {
      const conn = connect({ datasets: parseDatasets(datasets ?? ""), apiUrl: this.getAttribute("api-url") ?? undefined });
      // With rows, the page ran the SQL itself; show every declared dataset as a source.
      const [data, sources] = await Promise.all([sql ? conn.sql(sql) : JSON.parse(rows ?? "[]"), conn.sources(sql ?? undefined)]);
      if (run !== this.#run) return;
      this.innerHTML = `<div></div>${attributionHtml(sources)}`;
      const { finalize } = await renderChart(this.firstElementChild as HTMLElement, JSON.parse(spec), data);
      if (run === this.#run) this.#finalize = finalize;
      else finalize();
    } catch (e) {
      if (run === this.#run) this.innerHTML = `<p class="queria-note">${esc(String(e))}</p>`;
    }
  }
}

/**
 * <queria-map datasets="queria/e_stat" sql="..." layer='{"area": "city", "code": "lg_code", "color": "population"}'>
 * Runs the SQL and puts the rows on a map by area code or by lng/lat, followed by the sources of the datasets.
 * `rows`, `api-url` work as on <queria-chart>. `theme` is light or dark; `map-style` takes another MapLibre style URL.
 * Include maplibre-gl's CSS in the page. The map height is the CSS variable --queria-map-height (400px by default).
 */
export class QueriaMap extends HTMLElement {
  static observedAttributes = ["datasets", "sql", "layer", "rows", "api-url", "theme", "map-style"];
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
    const [datasets, sql, layer, rows, theme, style] = ["datasets", "sql", "layer", "rows", "theme", "map-style"].map((a) => this.getAttribute(a));
    if (!layer || (!rows && !sql)) return;
    const run = ++this.#run;
    this.#clear();
    this.innerHTML = '<p class="queria-note">Loading…</p>';
    try {
      const conn = connect({ datasets: parseDatasets(datasets ?? ""), apiUrl: this.getAttribute("api-url") ?? undefined });
      const [data, sources] = await Promise.all([sql ? conn.sql(sql) : JSON.parse(rows ?? "[]"), conn.sources(sql ?? undefined)]);
      if (run !== this.#run) return;
      this.innerHTML = `<div style="height:var(--queria-map-height,400px)"></div>${attributionHtml(sources)}`;
      const { finalize } = await renderMap(this.firstElementChild as HTMLElement, JSON.parse(layer), data, {
        theme: theme === "dark" ? "dark" : "light",
        ...(style ? { style } : {}),
      });
      if (run === this.#run) this.#finalize = finalize;
      else finalize();
    } catch (e) {
      if (run === this.#run) this.innerHTML = `<p class="queria-note">${esc(String(e))}</p>`;
    }
  }
}

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
