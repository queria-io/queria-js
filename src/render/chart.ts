import { type Annotation, withAnnotations } from "./annotate.js";
import { SERIES } from "./palette.js";
import { type Encoding, isView, keysOf, type View } from "./view.js";
import type { EmbedOptions, Result, VisualizationSpec } from "vega-embed";

/** A Vega-Lite spec. Its data is put in by the package. */
export type ChartSpec = VisualizationSpec | Record<string, unknown>;

export type Rows = readonly Record<string, unknown>[];

// Vega writes an id into every row it reads, so hand it copies: the caller's rows may be frozen or shared.
const copy = (rows: Rows): Record<string, unknown>[] => rows.map((r) => ({ ...r }));

export const isRows = (d: Rows | Readonly<Record<string, Rows>>): d is Rows => Array.isArray(d);

/**
 * Whether the spec is split into panels by a facet operator or by a row, column or facet encoding. Vega-Lite drops
 * those encodings from a layer's shared encoding, so only a single view with a mark is split by them.
 */
const isFaceted = (spec: ChartSpec): boolean => {
  if ("facet" in spec) return true;
  const encoding: unknown = "encoding" in spec && "mark" in spec ? spec.encoding : undefined;
  return typeof encoding === "object" && encoding !== null && ["row", "column", "facet"].some((k) => k in encoding);
};

/**
 * Whether the spec lays out several views: concatenated, repeated, or split into panels by a facet operator or by a
 * row, column or facet encoding. Vega-Lite sizes each view of these by itself, so width "container" and autosize fit do not apply.
 */
export const isComposite = (spec: ChartSpec): boolean => ["repeat", "concat", "hconcat", "vconcat"].some((k) => k in spec) || isFaceted(spec);

const panelOf = (spec: ChartSpec): unknown => ("facet" in spec && "spec" in spec ? spec.spec : spec);

/**
 * Whether the panels of the spec are sized to the width they are drawn in: a facet whose panel has no width of its own.
 * Vega-Lite does not size panels to a container, so they are given a width, which fitPanels then changes.
 */
export const fitsPanels = (spec: ChartSpec): boolean => {
  const panel = panelOf(spec);
  return isFaceted(spec) && typeof panel === "object" && panel !== null && !("width" in panel);
};

// The width the panels start with, before fitPanels has measured the chart.
const START_WIDTH = 100;
// Narrower panels are not drawn: the chart is left wider than its container instead. A panel with categories on
// its x axis is kept at MIN_STEP or more for each, so that the bars and labels do not shrink to slivers.
const MIN_PANEL = 80;
const MIN_STEP = 12;

/** The spec with a width for its panels to start from, which fitPanels changes. For specs where fitsPanels is true. */
export const withPanelWidth = (spec: ChartSpec): ChartSpec =>
  "facet" in spec && "spec" in spec && typeof spec.spec === "object" && spec.spec !== null
    ? { ...spec, spec: { width: START_WIDTH, ...spec.spec } }
    : { width: START_WIDTH, ...spec };

type Scene = { name?: string; role?: string; x?: number; items?: Scene[]; bounds?: { x1: number; x2: number } };

// Legends and the chart title are as wide as their text, whatever the width of the panels.
const SIDE = new Set(["legend", "title"]);

const spanOf = (marks: readonly Scene[]): { x1: number; x2: number } | undefined => {
  const spans = marks.flatMap((m) => (m.bounds ? [m.bounds] : []));
  return spans.length ? { x1: Math.min(...spans.map((b) => b.x1)), x2: Math.max(...spans.map((b) => b.x2)) } : undefined;
};

/**
 * The width of each panel so that the panels, their headers and axes take `width` in all, from the chart as drawn with
 * `panel` as the panel width. The panels in a row are the cells with different x. A legend beside the panels takes its
 * own width out of `width`; one above or below them, and the title, are left out.
 */
export const panelWidth = (root: Scene, panel: number, width: number, least = MIN_PANEL): number => {
  const all = root.items?.[0]?.items ?? [];
  const marks = all.filter((m) => !SIDE.has(m.role ?? ""));
  const columns = new Set((marks.find((m) => m.name === "cell")?.items ?? []).map((c) => c.x)).size || 1;
  const panels = spanOf(marks);
  const beside = panels ? all.filter((m) => m.role === "legend" && m.bounds && (m.bounds.x1 >= panels.x2 || m.bounds.x2 <= panels.x1)) : [];
  const span = spanOf([...marks, ...beside]);
  const drawn = span ? span.x2 - span.x1 : 0;
  return Math.max(Math.floor((width - (drawn - columns * panel)) / columns), least);
};

const isScene = (x: unknown): x is Scene => typeof x === "object" && x !== null;

// The typings of vega give the root mark as the scene graph, which is in fact { root }.
const rootOf = (view: Result["view"]): Scene => {
  const graph: unknown = view.scenegraph();
  return isScene(graph) && "root" in graph && isScene(graph.root) ? graph.root : {};
};

/**
 * Size the panels of a chart drawn from a spec for which fitsPanels is true, so that the chart is `width` wide.
 * The second pass corrects for axis labels that change with the panel width.
 */
// The least width of a panel: MIN_STEP for each category on a shared x axis of categories, at least MIN_PANEL.
const leastPanel = (view: Result["view"]): number => {
  // Panels with x scales of their own have no scale named x.
  const x: unknown = (() => {
    try {
      return view.scale("x");
    } catch {
      return undefined;
    }
  })();
  const domain: unknown = typeof x === "function" && "bandwidth" in x && "domain" in x && typeof x.domain === "function" ? x.domain() : [];
  return Math.max(MIN_PANEL, (Array.isArray(domain) ? domain.length : 0) * MIN_STEP);
};

export const fitPanels = async (view: Result["view"], width: number, passes = 2): Promise<void> => {
  const panel = Number(view.signal("child_width"));
  const next = panelWidth(rootOf(view), panel, width, leastPanel(view));
  if (passes === 0 || Math.abs(next - panel) < 1) return;
  await view.signal("child_width", next).resize().runAsync();
  return fitPanels(view, width, passes - 1);
};

const padX = (view: Result["view"]): number => {
  const p = view.padding();
  return typeof p === "number" ? p * 2 : (p.left ?? 0) + (p.right ?? 0);
};

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
  return {
    ...(isComposite(spec) ? {} : { width: "container" }),
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
export const TONES = {
  light: { fg: "#18181b", muted: "#6b6b76", border: "#e4e4e8", base: "#a1a1aa", accent: "#7846be" },
  dark: { fg: "#f4f4f5", muted: "#a1a1aa", border: "#2c2c31", base: "#71717a", accent: "#a985e6" },
} as const;

/** Colors of several series. The purple is left out, so it always means "highlighted". */

/**
 * Axis labels for numbers: 万 and 億 on Japanese pages, k / M / G elsewhere. Numbers under 10,000 are written in full without separators, so years read as years.
 * An expression, so the chart keeps no function of its own.
 */
export const numberLabel = (japanese: boolean): string =>
  japanese
    ? "abs(datum.value) >= 1e8 ? format(datum.value / 1e8, ',.4~r') + '億' : abs(datum.value) >= 1e4 ? format(datum.value / 1e4, ',.4~r') + '万' : format(datum.value, '.4~r')"
    : "abs(datum.value) >= 1e4 ? format(datum.value, '.3~s') : format(datum.value, '.4~r')";

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

const markType = (mark: unknown): unknown => (typeof mark === "object" && mark !== null && "type" in mark ? mark.type : mark);

/**
 * Color the highlighted values purple and the rest gray. With a color field, the series named in values are purple;
 * without one, the marks whose x, y or detail value is in values are (category axes are tried before number axes).
 * Text marks keep their color, and so do colors by a number (a heatmap). Layers are colored one by one, each with
 * the rows it reads: those named by its data.name, or else those of the view around it. When no value is found, the
 * spec is returned as it is.
 */
export const withHighlight = (
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  values: readonly unknown[],
  accent: string,
  base: string,
): ChartSpec => {
  // Compared as text, so "2020" from an HTML attribute matches the number 2020 in the rows.
  const texts = values.map(String);
  const hit = (v: unknown): boolean => keysOf(v).some((k) => texts.includes(k));
  const named = (v: View): Rows | undefined => {
    const name = isView(v.data) ? v.data.name : undefined;
    return isRows(data) || typeof name !== "string" ? undefined : data[name];
  };
  const color = (enc: Encoding, rows: Rows): Encoding => {
    const field = enc.color?.field;
    if (typeof field === "string") {
      if (enc.color?.type === "quantitative") return enc;
      const { scheme: _, ...scale } = isView(enc.color?.scale) ? enc.color.scale : {};
      // The author's order of the series, or else the order of the rows
      const domain = Array.isArray(scale.domain)
        ? (scale.domain as unknown[])
        : [...new Set(rows.map((r) => r[field]))].filter((d) => d !== undefined);
      return domain.some(hit)
        ? { ...enc, color: { ...enc.color, scale: { ...scale, domain, range: domain.map((d) => (hit(d) ? accent : base)) } } }
        : enc;
    }
    const key = ["x", "y", "detail"]
      .sort((a, b) => Number(enc[a]?.type === "quantitative") - Number(enc[b]?.type === "quantitative"))
      .map((c) => enc[c]?.field)
      .find((f): f is string => typeof f === "string" && rows.some((r) => hit(r[f])));
    if (key === undefined) return enc;
    const [t, k] = [JSON.stringify(texts), JSON.stringify(key)];
    return {
      ...enc,
      color: {
        condition: { test: `indexof(${t}, '' + datum[${k}]) >= 0 || (isDate(datum[${k}]) && indexof(${t}, utcFormat(datum[${k}], '%Y-%m-%d')) >= 0)`, value: accent },
        value: base,
      },
    };
  };
  const paint = (v: View, around: Rows): View => {
    const rows = named(v) ?? around;
    const encoding = v.encoding && markType(v.mark) !== "text" ? color(v.encoding, rows) : v.encoding;
    const layer = v.layer?.map((l) => paint(l, rows));
    const changed = encoding !== v.encoding || (layer?.some((l, i) => l !== v.layer?.[i]) ?? false);
    return changed ? { ...v, ...(encoding ? { encoding } : {}), ...(layer ? { layer } : {}) } : v;
  };
  return isView(spec) ? paint(spec, isRows(data) ? data : Object.values(data).flat()) : spec;
};

export type ChartOptions = {
  /** Values to color purple, such as a name on the axis or a series. Everything else stays gray. */
  highlight?: unknown;
  /** Notes with arrows to the rows they are about. See Annotation. */
  annotations?: readonly Annotation[];
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

type Drawer = {
  embed: (el: HTMLElement, spec: VisualizationSpec, options: EmbedOptions) => Promise<Result>;
  expressionInterpreter: EmbedOptions["expr"];
};

let drawer: Promise<Drawer> | undefined;

const loadDrawer = (): Promise<Drawer> =>
  (drawer ??= Promise.all([import("vega-embed"), import("vega-interpreter")]).then(
    ([e, i]) => ({ embed: e.default, expressionInterpreter: i.expressionInterpreter }),
    // Try again on the next chart when the network failed
    (e: unknown) => {
      drawer = undefined;
      throw e;
    },
  ));

/**
 * Start loading what draws charts, so that the first renderChart does not wait for it. Call it while the data loads.
 */
export const preloadChart = (): Promise<void> =>
  loadDrawer().then(
    () => undefined,
    () => undefined,
  );

const CANVAS_ABOVE = 5000;

const rowCount = (data: Rows | Readonly<Record<string, Rows>>): number =>
  isRows(data) ? data.length : Object.values(data).reduce((n, rows) => n + rows.length, 0);

/**
 * Draw a Vega-Lite chart. What draws it is loaded on first use, or earlier with preloadChart. Expressions are run by the
 * interpreter, so charts draw on pages whose Content Security Policy has no unsafe-eval.
 * Returns the Vega view, a function that removes the chart, whether a highlighted value was found, and how many
 * annotations were drawn.
 * Sources and licenses are not drawn here; the elements and React components add them under the chart.
 */
export const renderChart = async (
  el: HTMLElement,
  spec: ChartSpec,
  data: Rows | Readonly<Record<string, Rows>>,
  { config, actions = false, i18n, theme, renderer, highlight, annotations = [] }: ChartOptions = {},
): Promise<Pick<Result, "view" | "finalize"> & { highlighted: boolean; annotated: number }> => {
  const style = getComputedStyle(el);
  const tone = theme ?? toneOf(style.color);
  const { embed, expressionInterpreter } = await loadDrawer();
  const shown = highlight === undefined ? spec : withHighlight(spec, data, [highlight].flat(), TONES[tone].accent, TONES[tone].base);
  const { fg, muted } = TONES[tone];
  const noted = withAnnotations(shown, isRows(data) ? data : Object.values(data).flat(), annotations, { text: fg, line: muted });
  const { view, finalize } = await embed(el, withData(fitsPanels(spec) ? withPanelWidth(noted.spec) : noted.spec, data) as VisualizationSpec, {
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
  // Whether a highlighted value was found, and how many notes were drawn. Values that are not found are left out
  const result = { view, highlighted: shown !== spec, annotated: noted.added };
  if (!fitsPanels(spec)) return { ...result, finalize };
  // Panels are sized to the element as width "container" sizes a single view, again when the element is resized.
  const measure = (): Promise<void> => {
    const { paddingLeft, paddingRight } = getComputedStyle(el);
    const width = el.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
    return width > 0 ? fitPanels(view, width - padX(view)) : Promise.resolve();
  };
  // One fit at a time: a fit reads the chart as the one before it left it.
  let fitting = Promise.resolve();
  const fit = (): Promise<void> => (fitting = fitting.then(measure, measure));
  try {
    await fit();
  } catch (e) {
    finalize();
    throw e;
  }
  // A resize that comes while the chart is being removed has nothing left to size.
  const observer = new ResizeObserver(() => {
    fit().catch(() => undefined);
  });
  observer.observe(el);
  return {
    ...result,
    finalize: () => {
      observer.disconnect();
      finalize();
    },
  };
};
