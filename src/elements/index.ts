import { connect, parseDatasets } from "../client.js";
import { attributionHtml } from "../render/attribution.js";
import { renderChart } from "../render/chart.js";
import { esc } from "../render/escape.js";
import { poweredByHtml } from "../render/poweredBy.js";

/**
 * <queria-chart datasets="queria/e_stat" sql="..." spec='{"mark": "line", ...}'>
 * Runs the SQL and draws the rows with the Vega-Lite spec, followed by the sources of the datasets.
 * Instead of sql, `rows` takes the rows as JSON, for pages that run the SQL at build time.
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
      const conn = sql ? connect({ datasets: parseDatasets(datasets ?? ""), apiUrl: this.getAttribute("api-url") ?? undefined }) : null;
      const [data, sources] = conn && sql ? await Promise.all([conn.sql(sql), conn.sources(sql)]) : [JSON.parse(rows ?? "[]"), []];
      if (run !== this.#run) return;
      this.innerHTML = `<div></div>${attributionHtml(sources)}`;
      const finalize = await renderChart(this.firstElementChild as HTMLElement, JSON.parse(spec), data);
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

const elements = { "queria-chart": QueriaChart, "queria-powered-by": QueriaPoweredBy };

/** Register the custom elements. Safe to call more than once. */
export const defineElements = (): void =>
  Object.entries(elements).forEach(([name, cls]) => customElements.get(name) ?? customElements.define(name, cls));

declare global {
  interface HTMLElementTagNameMap {
    "queria-chart": QueriaChart;
    "queria-powered-by": QueriaPoweredBy;
  }
}
