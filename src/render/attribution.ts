import type { Dataset } from "../client.js";
import { esc } from "./escape.js";
import { logo } from "./poweredBy.js";

const link = (url: string | undefined, text: string): string =>
  url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:inherit">${esc(text)}</a>` : esc(text);

const sourcesText = (datasets: readonly Dataset[]): string =>
  datasets
    .map((d) => {
      const licenses = (d.licenses ?? []).map((l) => link(l.url, l.title ?? l.id ?? "")).filter(Boolean);
      return link(d.page_url, d.title ?? d.qualified_name) + (licenses.length ? ` (${licenses.join(", ")})` : "");
    })
    .join("; ");

/** The SQL behind the chart, folded, with a link that opens it on queria.io. Shown only when the chart ran SQL. */
const sqlHtml = (sql: string, url: string): string =>
  '<details class="queria-sql" style="margin-top:4px;font:12px/1.5 system-ui,sans-serif">' +
  '<summary style="cursor:pointer;opacity:.7">SQL</summary>' +
  `<pre style="margin:4px 0;padding:8px;overflow:auto;white-space:pre-wrap;border-radius:6px;background:rgba(127,127,127,.12);font:12px/1.5 ui-monospace,monospace">${esc(sql)}</pre>` +
  `${link(url, "Open in Queria")}</details>`;

/**
 * The line under a chart or map: the sources and licenses of the datasets on the left, as licenses such as CC BY
 * require wherever the data is shown, and the Queria logo on the right. Colors follow the page's text color.
 */
export const attributionHtml = (datasets: readonly Dataset[], sql?: { sql: string; url: string }): string =>
  '<div class="queria-attribution" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:8px;font:12px/1.5 system-ui,sans-serif;opacity:.7">' +
  `<span>${datasets.length ? `Source: ${sourcesText(datasets)}` : ""}</span>` +
  '<a href="https://queria.io/" target="_blank" rel="noopener" aria-label="Queria" style="flex:none;display:inline-block;height:14px;width:59px;color:inherit">' +
  `${logo}</a></div>` +
  (sql ? sqlHtml(sql.sql, sql.url) : "");
