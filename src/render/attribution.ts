import type { Dataset } from "../client.js";
import { esc } from "./escape.js";

const link = (url: string | undefined, text: string): string =>
  url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);

/**
 * Markup of the sources and licenses of the datasets, for display under a chart or map.
 * Licenses such as CC BY require it wherever the data is shown.
 */
export const attributionHtml = (datasets: readonly Dataset[]): string =>
  datasets.length === 0
    ? ""
    : '<p class="queria-attribution" style="margin:4px 0 0;font:12px/1.5 system-ui,sans-serif;color:#737373">Source: ' +
      datasets
        .map((d) => {
          const licenses = (d.licenses ?? []).map((l) => link(l.url, l.title ?? l.id ?? "")).filter(Boolean);
          return link(d.page_url, d.title ?? d.qualified_name) + (licenses.length ? ` (${licenses.join(", ")})` : "");
        })
        .join("; ") +
      "</p>";
