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

/**
 * The line under a chart or map: the sources and licenses of the datasets on the left, as licenses such as CC BY
 * require wherever the data is shown, and the Queria logo on the right. Colors follow the page's text color.
 */
export const attributionHtml = (datasets: readonly Dataset[]): string =>
  '<div class="queria-attribution" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:8px;font:12px/1.5 system-ui,sans-serif;opacity:.7">' +
  `<span>${datasets.length ? `Source: ${sourcesText(datasets)}` : ""}</span>` +
  '<a href="https://queria.io/" target="_blank" rel="noopener" aria-label="Queria" style="flex:none;display:inline-block;height:14px;width:59px;color:inherit">' +
  `${logo}</a></div>`;
