import type { Dataset } from "../client.js";
import { chartTheme, isComposite, isRows, TONES, withData, withHighlight, type ChartSpec, type Rows, type Tone } from "./chart.js";
import { withAnnotations, type Annotation } from "./annotate.js";
import { sourcesText } from "./attribution.js";
import { esc } from "./escape.js";
import { logo } from "./poweredBy.js";

export type ChartImageOptions = {
  /** Width and height of the image in CSS pixels, sources line included. 600 × 315 by default, which chartPng makes 1200 × 630, the size of a social media card. Charts placed side by side or split into panels keep their own size. */
  width?: number;
  height?: number;
  /** Light or dark colors. Light by default. */
  theme?: Tone;
  /** Values to color purple, as in renderChart. */
  highlight?: unknown;
  /** Notes with arrows to the rows they are about, as in renderChart. */
  annotations?: readonly Annotation[];
  /** Datasets to name in a line under the chart, with the Queria logo. Without them, the image is the chart alone. */
  sources?: readonly Dataset[];
  /** Font of the chart. The image uses the fonts installed where it is drawn. */
  font?: string;
  /** Number labels in 万 and 億 when true (the default), k / M / G otherwise. */
  japanese?: boolean;
  /** Vega-Lite config laid over the Queria theme. */
  config?: Record<string, unknown>;
};

const BACKGROUND = { light: "#ffffff", dark: "#18181b" } as const;
const PADDING = 24;
const FOOTER = 36;
const SIZE = 13;

// Width of a line in ems: full-width characters take 1, others about 0.6.
const ems = (text: string): number => [...text].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0x2e7f ? 1 : 0.6), 0);

// The same line as under the charts on the page, as plain text.
const sourcesLine = (datasets: readonly Dataset[]): string => `Source: ${sourcesText(datasets, (_, text) => text)}`;

const sizeOf = (svg: string): [number, number] => {
  const root = /<svg[^>]*>/.exec(svg)?.[0] ?? "";
  const n = (k: string): number => Number(new RegExp(`\\s${k}="([\\d.]+)"`).exec(root)?.[1] ?? 0);
  return [n("width"), n("height")];
};

/** The chart with a line of sources and the logo under it, on the page color. */
const withFooter = (chart: string, datasets: readonly Dataset[], tone: Tone, font: string): string => {
  const [w, h] = sizeOf(chart);
  const { fg, muted } = TONES[tone];
  const [logoW, logoH] = [Math.round((SIZE + 3) * 4.17), SIZE + 3];
  const text = sourcesLine(datasets);
  const room = Math.max(w - PADDING * 3 - logoW, 0);
  // A long line is squeezed to fit rather than cut, so every source stays named.
  const fit = room > 0 && ems(text) * SIZE > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : "";
  const y = h + FOOTER / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + FOOTER}" viewBox="0 0 ${w} ${h + FOOTER}">` +
    `<rect width="100%" height="100%" fill="${BACKGROUND[tone]}"/>${chart}` +
    `<text x="${PADDING}" y="${y}" dominant-baseline="central" font-family="${esc(font)}" font-size="${SIZE}" fill="${muted}"${fit}>${esc(text)}</text>` +
    logo.replace("<svg ", `<svg x="${w - PADDING - logoW}" y="${y - logoH / 2}" width="${logoW}" height="${logoH}" color="${fg}" `) +
    "</svg>"
  );
};

/**
 * Draw a chart as an SVG image in Queria's look, on a solid background, with the sources under it when they are given.
 * Works in browsers and in Node, so images for social media cards can be made on a server or at build time.
 */
export const chartSvg = async (
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  { width = 600, height = 315, theme = "light", highlight, annotations = [], sources = [], font = "system-ui, sans-serif", japanese = true, config }: ChartImageOptions = {},
): Promise<string> => {
  const [vega, vl, { expressionInterpreter }] = await Promise.all([import("vega"), import("vega-lite"), import("vega-interpreter")]);
  const shown = highlight === undefined ? spec : withHighlight(spec, data, [highlight].flat(), TONES[theme].accent, TONES[theme].base);
  const { fg, muted } = TONES[theme];
  const noted = withAnnotations(shown, isRows(data) ? data : Object.values(data).flat(), annotations, { text: fg, line: muted });
  const footer = sources.length > 0 ? FOOTER : 0;
  const full = {
    ...withData(noted.spec, data),
    ...(isComposite(spec) ? {} : { width, height: height - footer, autosize: { type: "fit", contains: "padding" } }),
    padding: PADDING,
  };
  // The theme goes in as the compile option, so the spec's own config is merged over it, as renderChart does.
  const { spec: compiled } = vl.compile(full as Parameters<typeof vl.compile>[0], {
    config: { ...chartTheme(theme, font, japanese), background: BACKGROUND[theme], ...config },
  });
  const view = new vega.View(vega.parse(compiled, undefined, { ast: true }), { renderer: "none", expr: expressionInterpreter });
  try {
    const svg = await view.toSVG();
    return sources.length > 0 ? withFooter(svg, sources, theme, font) : svg;
  } finally {
    view.finalize();
  }
};

/**
 * Draw a chart as a PNG image for posting on social media, as chartSvg does, at `scale` times its size (2 by default).
 * Browsers only. Save it with a link whose href is URL.createObjectURL(blob) and whose download is a file name.
 */
export const chartPng = async (
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  { scale = 2, ...options }: ChartImageOptions & { scale?: number } = {},
): Promise<Blob> => {
  const svg = await chartSvg(spec, data, options);
  const [w, h] = sizeOf(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(w * scale), height: Math.round(h * scale) });
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser cannot draw on a canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The chart could not be made into a PNG"))), "image/png"),
  );
};
