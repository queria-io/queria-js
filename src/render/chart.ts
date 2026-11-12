import { SERIES } from "./palette.js";
import type { EmbedOptions, Result, VisualizationSpec } from "vega-embed";

/** A Vega-Lite spec. Its data is put in by the package. */
export type ChartSpec = VisualizationSpec | Record<string, unknown>;

export type Rows = readonly Record<string, unknown>[];

// Vega writes an id into every row it reads, so hand it copies: the caller's rows may be frozen or shared.
const copy = (rows: Rows): Record<string, unknown>[] => rows.map((r) => ({ ...r }));

const isRows = (d: Rows | Readonly<Record<string, Rows>>): d is Rows => Array.isArray(d);

const ownDatasets = (spec: ChartSpec): object => {
  const d: unknown = "datasets" in spec ? spec.datasets : undefined;
  return typeof d === "object" && d !== null ? d : {};
};

/**
 * Put the data into the spec. With rows, they become the data of a spec that has none.
 * With named rows, the spec (or its layers) picks them with data: { name }; rows named "" are the default data.
 */
export const withData = (spec: ChartSpec, data: Rows | Readonly<Record<string, Rows>>): Record<string, unknown> => {
  const named = isRows(data) ? { "": data } : data;
  const { "": main, ...rest } = named;
  // Vega-Lite takes width "container" only for single and layered views, and warns on the others.
  const composite = ["facet", "repeat", "concat", "hconcat", "vconcat"].some((k) => k in spec);
  return {
    ...(composite ? {} : { width: "container" }),
    ...spec,
    ...(main && !("data" in spec) ? { data: { values: copy(main) } } : {}),
    // The spec's own datasets stay; named rows are laid over them.
    ...(Object.keys(rest).length
      ? { datasets: { ...ownDatasets(spec), ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, copy(v)])) } }
      : {}),
  };
};

export type Tone = "light" | "dark";

// base is the color of a single series; accent, the Queria purple, is kept for what the chart highlights.
const TONES = {
  light: { fg: "#18181b", muted: "#6b6b76", border: "#e4e4e8", base: "#a1a1aa", accent: "#7846be" },
  dark: { fg: "#f4f4f5", muted: "#a1a1aa", border: "#2c2c31", base: "#71717a", accent: "#a985e6" },
} as const;

/** Colors of several series. The purple is left out, so it always means "highlighted". */

/**
 * Axis labels for numbers: 万 and 億 on Japanese pages, k / M / G elsewhere. Small numbers are written in full.
 * An expression, so the chart keeps no function of its own.
 */
export const numberLabel = (japanese: boolean): string =>
  japanese
    ? "abs(datum.value) >= 1e8 ? format(datum.value / 1e8, ',.4~r') + '億' : abs(datum.value) >= 1e4 ? format(datum.value / 1e4, ',.4~r') + '万' : format(datum.value, ',.4~r')"
    : "abs(datum.value) >= 1e4 ? format(datum.value, '.3~s') : format(datum.value, ',.4~r')";

/**
 * Queria's look: gray marks, the Queria purple only for highlighted values, rounded bars, a legend above the chart,
 * and colors for a light or dark page.
 */
export const chartTheme = (tone: Tone = "light", font = "system-ui, sans-serif", japanese = true): Record<string, unknown> => {
  const { fg, muted, border, base } = TONES[tone];
  return {
    background: "transparent",
    font,
    view: { stroke: null },
    range: { category: SERIES },
    title: { color: fg, fontSize: 15, fontWeight: 600, anchor: "start", offset: 12 },
    axis: { labelColor: muted, titleColor: muted, titleFontWeight: "normal", labelFontSize: 11, titleFontSize: 11, gridColor: border, domain: false, ticks: false, labelPadding: 6 },
    axisX: { labelAngle: 0 },
    axisQuantitative: { labelExpr: numberLabel(japanese), tickCount: 5 },
    legend: { orient: "top", title: null, labelColor: fg, labelFontSize: 12, symbolType: "circle" },
    header: { labelColor: fg, titleColor: fg },
    mark: { color: base, tooltip: true },
    bar: { cornerRadiusEnd: 6 },
    scale: { bandPaddingInner: 0.35 },
    line: { strokeWidth: 2.5 },
    point: { filled: true, size: 40 },
    text: { color: fg },
    rule: { color: muted },
  };
};

/** The page's font, unless it is the browser's default serif: pages that set no font get a sans-serif. */
export const fontOf = (family: string): string | undefined =>
  family === "" || /^("?times new roman"?|"?times"?|serif|-webkit-standard)$/i.test(family.split(",")[0].trim()) ? undefined : family;

// Whether a computed color is light. Browsers give it as rgb(), or in the space it was written in, such as
// oklch() from Tailwind CSS v4, so each space is read with its own scale; mid gray (#808080) is the threshold.
const isLight = (color: string): boolean | undefined => {
  const head = /^([a-z]+)\(\s*([a-z][a-z0-9-]*)?/i.exec(color.trim());
  if (head === null) return undefined;
  const [x, y, z] = (color.trim().slice(head[0].length).match(/-?[\d.]+/g) ?? []).map(Number);
  if (x === undefined) return undefined;
  const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  switch (head[1].toLowerCase()) {
    case "rgb":
    case "rgba":
      return y === undefined || z === undefined ? undefined : luma(x, y, z) > 128;
    case "color":
      return y === undefined || z === undefined ? undefined : luma(x, y, z) > 0.5;
    case "oklch":
    case "oklab":
      return x > 0.6;
    case "lab":
    case "lch":
      return x > 54;
    default:
      return undefined;
  }
};

/** Dark when the element's text is light, so the chart follows the page without being told. */
export const toneOf = (color: string): Tone => (isLight(color) ? "dark" : "light");

type Encoding = Record<string, { field?: unknown; [k: string]: unknown } | undefined>;
type View = { mark?: unknown; encoding?: Encoding; layer?: View[]; [k: string]: unknown };

const isView = (v: unknown): v is View => typeof v === "object" && v !== null && !Array.isArray(v);

const markType = (mark: unknown): unknown => (typeof mark === "object" && mark !== null && "type" in mark ? mark.type : mark);

/**
 * Color the highlighted values purple and the rest gray. With a color field, the series named in values are purple;
 * without one, the marks whose x, y or detail value is in values are. Text marks keep their color. Layers are
 * colored one by one.
 */
export const withHighlight = (spec: ChartSpec, rows: Rows, values: readonly unknown[], accent: string, base: string): ChartSpec => {
  // Compared as text, so "2020" from an HTML attribute matches the number 2020 in the rows.
  const texts = values.map(String);
  const hit = (v: unknown): boolean => texts.includes(String(v));
  const color = (enc: Encoding): Encoding => {
    const field = enc.color?.field;
    if (typeof field === "string") {
      const domain = [...new Set(rows.map((r) => r[field]))];
      return { ...enc, color: { ...enc.color, scale: { domain, range: domain.map((d) => (hit(d) ? accent : base)) } } };
    }
    const key = ["y", "x", "detail"].map((c) => enc[c]?.field).find((f): f is string => typeof f === "string" && rows.some((r) => hit(r[f])));
    return key === undefined
      ? enc
      : { ...enc, color: { condition: { test: `indexof(${JSON.stringify(texts)}, '' + datum[${JSON.stringify(key)}]) >= 0`, value: accent }, value: base } };
  };
  const paint = (v: View): View => ({
    ...v,
    ...(v.encoding && markType(v.mark) !== "text" ? { encoding: color(v.encoding) } : {}),
    ...(v.layer ? { layer: v.layer.map(paint) } : {}),
  });
  return isView(spec) ? paint(spec) : spec;
};

export type ChartOptions = {
  /** Values to color purple, such as a name on the axis or a series. Everything else stays gray. */
  highlight?: unknown;
  /** Vega-Lite config. Its top-level keys replace those of chartTheme, and the spec's own config is merged over it. */
  config?: Record<string, unknown>;
  /** Export and source menu. Hidden by default. */
  actions?: EmbedOptions["actions"];
  /** Labels of the menu. */
  i18n?: EmbedOptions["i18n"];
  /** Light or dark colors. By default, dark when the element's text color is light. */
  theme?: Tone;
  /** By default svg, and canvas when there are more than 5,000 rows in all. */
  renderer?: "svg" | "canvas";
};

const CANVAS_ABOVE = 5000;

const rowCount = (data: Rows | Readonly<Record<string, Rows>>): number =>
  isRows(data) ? data.length : Object.values(data).reduce((n, rows) => n + rows.length, 0);

/**
 * Draw a Vega-Lite chart. vega-embed and vega-interpreter are loaded on first use. Expressions are run by the
 * interpreter, so charts draw on pages whose Content Security Policy has no unsafe-eval.
 * Returns the Vega view and a function that removes the chart.
 * Sources and licenses are not drawn here; the elements and React components add them under the chart.
 */
export const renderChart = async (
  el: HTMLElement,
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  { config, actions = false, i18n, theme, renderer, highlight }: ChartOptions = {},
): Promise<Pick<Result, "view" | "finalize">> => {
  const style = getComputedStyle(el);
  const tone = theme ?? toneOf(style.color);
  const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
  const all = isRows(data) ? data : Object.values(data).flat();
  const shown = highlight === undefined ? spec : withHighlight(spec, all, [highlight].flat(), TONES[tone].accent, TONES[tone].base);
  const { view, finalize } = await embed(el, withData(shown, data) as VisualizationSpec, {
    // Read the spec as Vega-Lite even when its $schema says Vega
    mode: "vega-lite",
    ast: true,
    expr: expressionInterpreter,
    renderer: renderer ?? (rowCount(data) > CANVAS_ABOVE ? "canvas" : "svg"),
    actions,
    ...(i18n ? { i18n } : {}),
    config: { ...chartTheme(tone, fontOf(style.fontFamily), (el.closest("[lang]")?.getAttribute("lang") ?? "ja").startsWith("ja")), ...config },
    tooltip: { theme: tone },
  });
  return { view, finalize };
};
