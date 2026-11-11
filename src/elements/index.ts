import { sharedQueria } from "../client.js";
import { esc } from "../render/escape.js";
import { renderLineChart, toSeries } from "../render/lineChart.js";
import { poweredByHtml } from "../render/poweredBy.js";

const num = (v: string | null): number | undefined => (v === null ? undefined : Number(v));

/**
 * <queria-line-chart sql="..." x="year" y="population" by="area" label="...">
 * Runs the SQL and draws one line per distinct value of `by` (or a single line).
 */
export class QueriaLineChart extends HTMLElement {
  static observedAttributes = ["sql", "x", "y", "by", "label", "width", "height"];
  #run = 0;

  connectedCallback() {
    this.#draw();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#draw();
  }

  async #draw() {
    const [sql, x, y] = ["sql", "x", "y"].map((a) => this.getAttribute(a));
    if (!sql || !x || !y) return;
    const run = ++this.#run;
    this.innerHTML = '<p class="viz-note">Loading…</p>';
    try {
      const rows = await sharedQueria().query(sql);
      if (run !== this.#run) return;
      const series = toSeries(rows, { x, y, by: this.getAttribute("by") ?? undefined, label: this.getAttribute("label") ?? y });
      renderLineChart(this, series, { width: num(this.getAttribute("width")), height: num(this.getAttribute("height")) });
    } catch (e) {
      if (run === this.#run) this.innerHTML = `<p class="viz-note">${esc(String(e))}</p>`;
    }
  }
}

/** <queria-powered-by> */
export class QueriaPoweredBy extends HTMLElement {
  connectedCallback() {
    this.innerHTML = poweredByHtml();
  }
}

const elements = { "queria-line-chart": QueriaLineChart, "queria-powered-by": QueriaPoweredBy };

/** Register the custom elements. Safe to call more than once. */
export const defineElements = (): void =>
  Object.entries(elements).forEach(([name, cls]) => customElements.get(name) ?? customElements.define(name, cls));

declare global {
  interface HTMLElementTagNameMap {
    "queria-line-chart": QueriaLineChart;
    "queria-powered-by": QueriaPoweredBy;
  }
}
