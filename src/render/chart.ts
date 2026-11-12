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

// queria.io's foreground, muted and border colors.
const TONES = {
  light: { fg: "#0a0a0a", muted: "#737373", border: "#e5e5e5" },
  dark: { fg: "#fafafa", muted: "#a1a1a1", border: "rgba(255,255,255,0.1)" },
} as const;

/** The look of charts on queria.io: the page's font, plain axes and colors for a light or dark page. */
export const chartTheme = (tone: Tone = "light", font = "system-ui, sans-serif"): Record<string, unknown> => {
  const { fg, muted, border } = TONES[tone];
  return {
    background: "transparent",
    font,
    view: { stroke: null },
    title: { color: fg, fontSize: 14, fontWeight: 600, anchor: "start" },
    axis: { labelColor: muted, titleColor: fg, titleFontWeight: "normal", gridColor: border, domainColor: border, tickColor: border, labelFontSize: 11, titleFontSize: 12 },
    legend: { labelColor: fg, titleColor: fg, labelFontSize: 11 },
    header: { labelColor: fg, titleColor: fg },
    text: { color: fg },
    rule: { color: muted },
    mark: { tooltip: true },
  };
};

/** The page's font, unless it is the browser's default serif: pages that set no font get a sans-serif. */
export const fontOf = (family: string): string | undefined =>
  family === "" || /^("?times new roman"?|"?times"?|serif)$/i.test(family.split(",")[0].trim()) ? undefined : family;

/** Dark when the element's text is light, so the chart follows the page without being told. */
export const toneOf = (color: string): Tone => {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return r === undefined || g === undefined || b === undefined ? "light" : 0.2126 * r + 0.7152 * g + 0.0722 * b > 128 ? "dark" : "light";
};

export type ChartOptions = {
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
  { config, actions = false, i18n, theme, renderer }: ChartOptions = {},
): Promise<Pick<Result, "view" | "finalize">> => {
  const style = getComputedStyle(el);
  const tone = theme ?? toneOf(style.color);
  const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
  const { view, finalize } = await embed(el, withData(spec, data) as VisualizationSpec, {
    // Read the spec as Vega-Lite even when its $schema says Vega
    mode: "vega-lite",
    ast: true,
    expr: expressionInterpreter,
    renderer: renderer ?? (rowCount(data) > CANVAS_ABOVE ? "canvas" : "svg"),
    actions,
    ...(i18n ? { i18n } : {}),
    config: { ...chartTheme(tone, fontOf(style.fontFamily)), ...config },
    tooltip: { theme: tone },
  });
  return { view, finalize };
};
