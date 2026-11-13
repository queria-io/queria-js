import type { CircleLayerSpecification, ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import { type Rows, toneOf } from "./chart.js";
import { LAYER_COLORS, LINE_RAMP, OTHER, type Palette, PALETTES, RAMP, SERIES } from "./palette.js";
import { fetchFrom } from "../fetch.js";

export type AreaLevel = "prefecture" | "city" | "small_area";

/**
 * How rows are put on the map: by area code (the shapes come from Queria's boundary tiles), by longitude and latitude,
 * or by a column of GeoJSON geometries (as text or objects, such as the output of ST_AsGeoJSON).
 * The values are column names. `color` colors by a column, `label` names a row on hover or tap.
 */
export type MapLayer = ({ area: AreaLevel; code: string } | { lng: string; lat: string } | { geometry: string }) & {
  color?: string;
  label?: string;
  opacity?: number;
  /** The layer's name, shown as the legend's title instead of the column name, and on hover. */
  name?: string;
  /** Show what the colors mean. On by default when `color` is set. */
  legend?: boolean;
  /**
   * How `color` is colored: one color per value, or numbers on a linear or log scale. By default numbers (also
   * numbers written as text) run on a scale that suits their spread, and other values get one color each.
   */
  scale?: "category" | "linear" | "log";
  /** The ramp for numbers. A layer without `color` takes its dark end. By default Queria purple. */
  palette?: Palette;
  /** More columns shown on hover, one line each. */
  popup?: string[];
};

/** Queria's map styles. They keep their URL when the tiles are rebuilt, and hold the boundary sources. */
export const MAP_STYLES = {
  light: "https://assets.queria.io/maps/v1/light.json",
  dark: "https://assets.queria.io/maps/v1/dark.json",
} as const;

/** The style's source for each area level. Another style needs these sources to draw areas. */
export const boundarySource = (area: AreaLevel): string => `queria-${area}`;

/**
 * Put a code into the form of the boundary tiles: restore leading zeros lost in numeric columns, and drop
 * the check digit of a 6-digit local government code.
 */
export const areaCode = (area: AreaLevel, value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (area === "small_area") return text.length === 8 || text.length === 10 ? `0${text}` : text;
  const digits = area === "prefecture" ? 2 : 5;
  return text.length >= digits ? text.slice(0, digits) : text.padStart(digits, "0");
};

const hex = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const rgb = (color: string): number[] => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
const DEFAULT_RAMP = RAMP.map(hex);

/** The color at t (0 to 1) along the stops. */
const mix = (stops: readonly string[], t: number): string => {
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
  const [a, b] = [rgb(stops[i]), rgb(stops[i + 1])];
  return hex(a.map((v, k) => v + (b[k] - v) * (t * n - i)));
};

/** A CSS gradient along the stops from `from` to `to` (0 to 1), with the colors in between. */
const gradient = (stops: readonly string[], from = 0, to = 1): string =>
  `linear-gradient(to right,${Array.from({ length: 7 }, (_, k) => mix(stops, from + ((to - from) * k) / 6)).join(",")})`;

/**
 * What the colors mean: a range of numbers along the `colors` stops, or one color per value. `mid` is the value at
 * the middle of the ramp when the numbers are colored on a log scale. Values beyond the series colors are gathered
 * as the last item, in gray.
 */
export type Legend =
  | { column: string; min: number; max: number; mid?: number; colors: readonly string[] }
  | { column: string; items: { label: string; color: string }[] };

/** A number, also from text or a bigint, or null. */
const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "bigint" || (typeof v === "string" && v.trim() !== "") ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** A value as text: dates without a time as the date only, objects as JSON. */
const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof v === "object") return JSON.stringify(v, (_, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
  return String(v);
};

/** Whether values are categories: more of them are not numbers than are. A few "-" in a number column stay numbers. */
const isCategorical = (values: unknown[]): boolean => {
  let [text, numeric] = [0, 0];
  for (const v of values) {
    if (toNumber(v) !== null) numeric++;
    else if (v !== null && v !== undefined && textOf(v).trim() !== "") text++;
  }
  return text > numeric;
};

/**
 * Whether to color positive numbers on a log scale: when the largest is at least ten times the smallest and the
 * median falls in the lightest fifth of a linear ramp, so that half of the rows would look the same.
 */
const isSkewed = (sorted: number[]): boolean => {
  const [min, max, median] = [sorted[0], sorted[sorted.length - 1], sorted[sorted.length >> 1]];
  return min > 0 && max >= min * 10 && (median - min) / (max - min) < 0.2;
};

/** The name of the gathered categories. */
const otherLabel = (locale: string | undefined): string => (locale?.toLowerCase().startsWith("ja") ? "その他" : "Other");

export type ColorOptions = {
  scale?: MapLayer["scale"];
  /** The stops of the number ramp. */
  ramp?: readonly string[];
  /** The color of every row without a color column. */
  fixed?: string;
  /** The language of the "Other" category. */
  locale?: string;
};

/**
 * A color for each row, its position along the ramp (0 to 1, for line widths), and the legend. Numbers run from
 * light to dark between the smallest and largest value, on a log scale when a few values are far larger than the
 * rest; categories take the series colors in order of first appearance, and the values after the seventh are
 * gathered in gray. Only the rows that are `placed` on the map count, so a total row without a shape does not
 * stretch the range.
 */
export const colorScale = (
  rows: Rows,
  column: string | undefined,
  placed: (i: number) => boolean = () => true,
  { scale, ramp = DEFAULT_RAMP, fixed = LAYER_COLORS[0], locale }: ColorOptions = {},
): { colors: string[]; positions: number[] | null; legend: Legend | null } => {
  if (column === undefined) return { colors: rows.map(() => fixed), positions: null, legend: null };
  const values = rows.map((r) => r[column]);
  const shown = values.filter((_, i) => placed(i));
  if (scale === "category" || (scale === undefined && isCategorical(shown))) {
    const other = otherLabel(locale);
    const order = [...new Set(shown.map(textOf).filter((l) => l !== ""))];
    const overflow = order.length > SERIES.length;
    // When the values are gathered, a value that is itself "Other" joins them, so the legend has one "Other".
    const named = (overflow ? order.filter((l) => l !== other) : order).slice(0, SERIES.length);
    const colorOf = new Map(named.map((label, i) => [label, SERIES[i]]));
    return {
      colors: values.map((v) => colorOf.get(textOf(v)) ?? OTHER),
      positions: null,
      legend: { column, items: [...named.map((label) => ({ label, color: colorOf.get(label) ?? OTHER })), ...(overflow ? [{ label: other, color: OTHER }] : [])] },
    };
  }
  const nums = values.map(toNumber);
  const sorted = nums.filter((v, i): v is number => v !== null && placed(i)).sort((a, b) => a - b);
  if (sorted.length === 0) return { colors: rows.map(() => fixed), positions: null, legend: null };
  const [min, max] = [sorted[0], sorted[sorted.length - 1]];
  const log = scale === "log" ? min > 0 : scale === undefined && isSkewed(sorted);
  const at = log ? Math.log : (v: number) => v;
  const t = (v: number) => (max === min ? 1 : Math.min(1, Math.max(0, (at(v) - at(min)) / (at(max) - at(min)))));
  const positions = nums.map((v) => (v === null ? 0 : t(v)));
  return {
    colors: nums.map((v) => (v === null ? "#d4d4d4" : mix(ramp, t(v)))),
    positions,
    legend: { column, min, max, colors: ramp, ...(log && { mid: Math.sqrt(min * max) }) },
  };
};

const div = (style: string, text = ""): HTMLDivElement => Object.assign(document.createElement("div"), { textContent: text, style: style });

const formatNumber = (n: number, locale: string | undefined, digits?: number): string =>
  n.toLocaleString(locale, digits === undefined ? undefined : { maximumSignificantDigits: digits });

/** How a layer looks in the legend: its rows drawn as areas, lines or points. */
export type LayerKind = "fill" | "line" | "point";

/** What a layer added to a map shows in the legend. `color` is the layer's color when it has no color column. */
export type LegendEntry = {
  name?: string;
  kind: LayerKind;
  color: string;
  legend: Legend | null;
  /** The layer asked for no legend (`legend: false`). legendElement leaves it out. */
  hidden?: boolean;
};

const swatch = (kind: LayerKind, color: string): HTMLDivElement =>
  div(`flex:none;width:10px;height:${kind === "line" ? 3 : 10}px;border-radius:${kind === "point" ? "50%" : "2px"};background:${color}`);

export type LegendOptions = {
  /** The language of the numbers. By default the browser's. */
  locale?: string;
  /** The corner of the map the legend is drawn in. Top left by default. */
  corner?: "top-left" | "bottom-left";
};

/**
 * The legend drawn over a corner of the map: one section per layer, titled with the layer's name or else the
 * column. A layer without a color column shows its color when several layers are drawn. Labels come from the data,
 * so they are set as text. Returns null when there is nothing to show.
 */
export const legendElement = (
  entries: LegendEntry | LegendEntry[],
  theme: "light" | "dark",
  { locale, corner = "top-left" }: LegendOptions = {},
): HTMLElement | null => {
  const list = Array.isArray(entries) ? entries : [entries];
  const shown = list.filter((e) => !e.hidden && (e.legend !== null || (list.length > 1 && e.name)));
  if (shown.length === 0) return null;
  const box = div(
    `position:absolute;${corner === "top-left" ? "top" : "bottom"}:8px;left:8px;z-index:2;max-width:45%;padding:6px 8px;border-radius:4px;font:12px/1.4 sans-serif;display:flex;flex-direction:column;gap:4px;${theme === "dark" ? "background:rgba(23,23,23,.85);color:#e5e5e5" : "background:rgba(255,255,255,.9);color:#262626"}`,
  );
  box.className = "queria-legend";
  shown.forEach(({ name, kind, color, legend }) => {
    const section = div("");
    if (legend === null) {
      const item = div("display:flex;align-items:center;gap:4px;font-weight:600");
      item.append(swatch(kind, color), name ?? "");
      box.append(item);
      return;
    }
    section.append(div("font-weight:600;margin-bottom:2px", name ?? legend.column));
    if ("min" in legend) {
      // On a log scale the middle value shows that colors are not proportional to the values.
      const labels = [legend.min, ...(legend.mid === undefined ? [] : [legend.mid]), legend.max];
      const row = div("display:flex;justify-content:space-between;gap:8px");
      row.append(...labels.map((n, i) => div("", formatNumber(n, locale, i === 1 && labels.length === 3 ? 2 : undefined))));
      section.append(div(`width:120px;height:8px;border-radius:2px;background:${gradient(legend.colors)}`), row);
    } else {
      legend.items.forEach(({ label, color: c }) => {
        const item = div("display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis");
        item.append(swatch(kind, c), label);
        section.append(item);
      });
    }
    box.append(section);
  });
  return box;
};

/** The value of a cell on hover, numbers in the locale. */
const cellText = (v: unknown, locale: string | undefined): string => {
  const n = typeof v === "number" || typeof v === "bigint" ? toNumber(v) : null;
  return n === null ? textOf(v) : formatNumber(n, locale);
};

/** "column: value", or null when the cell is empty, so that hover shows no line without a value. */
const cellLine = (row: Record<string, unknown>, column: string, locale: string | undefined): string | null =>
  row[column] === null || row[column] === undefined || row[column] === "" ? null : `${column}: ${cellText(row[column], locale)}`;

/** Lines shown on hover: the layer's name, the label, the colored value, then the popup columns. */
const hoverLines = (row: Record<string, unknown>, layer: MapLayer, locale: string | undefined): string[] =>
  [
    layer.name ?? null,
    layer.label === undefined ? null : textOf(row[layer.label]),
    layer.color === undefined || layer.color === layer.label ? null : cellLine(row, layer.color, locale),
    ...(layer.popup ?? []).map((c) => cellLine(row, c, locale)),
  ].filter((l): l is string => !!l);

/** The row's [lng, lat], or null when either is missing, not a number, or out of range. */
const positionOf = (row: Record<string, unknown>, layer: { lng: string; lat: string }): [number, number] | null => {
  const [lng, lat] = [toNumber(row[layer.lng]), toNumber(row[layer.lat])];
  return lng === null || lat === null || Math.abs(lng) > 180 || Math.abs(lat) > 90 ? null : [lng, lat];
};

type Geometry = Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isLine = (g: Geometry): boolean => g.type === "LineString" || g.type === "MultiLineString";
const isPoint = (g: Geometry): boolean => g.type === "Point" || g.type === "MultiPoint";

/**
 * The simple geometries in a value: a GeoJSON geometry as text or an object. Geometry collections are split; a
 * polygon collected with a line is the line's arrowhead (`head`), and is filled with the line's color.
 */
export const geometryParts = (value: unknown): { geometry: Geometry; head: boolean }[] => {
  const g = typeof value === "string" ? parseJson(value) : value;
  if (g === null || typeof g !== "object" || !("type" in g)) return [];
  if (g.type === "GeometryCollection" && "geometries" in g && Array.isArray(g.geometries)) {
    const parts = g.geometries.flatMap(geometryParts);
    const withLine = parts.some((p) => isLine(p.geometry));
    return parts.map((p) => ({ geometry: p.geometry, head: p.head || (withLine && !isLine(p.geometry) && !isPoint(p.geometry)) }));
  }
  return "coordinates" in g && Array.isArray(g.coordinates) ? [{ geometry: g as Geometry, head: false }] : [];
};

/** The simple geometries in a value. */
export const geometriesOf = (value: unknown): Geometry[] => geometryParts(value).map((p) => p.geometry);

const parsedParts = new WeakMap<Record<string, unknown>, Map<string, ReturnType<typeof geometryParts>>>();

/**
 * The geometry parts of a row's column, parsed once per row: placing, coloring, drawing and fitting a layer all
 * read them, and the GeoJSON text of large shapes is slow to parse.
 */
const rowParts = (row: Record<string, unknown>, column: string): ReturnType<typeof geometryParts> => {
  let byColumn = parsedParts.get(row);
  if (!byColumn) parsedParts.set(row, (byColumn = new Map()));
  let parts = byColumn.get(column);
  if (!parts) byColumn.set(column, (parts = geometryParts(row[column])));
  return parts;
};

const rowGeometries = (row: Record<string, unknown>, column: string): Geometry[] => rowParts(row, column).map((p) => p.geometry);

/** Every [lng, lat] in nested coordinates. */
const positions = (c: unknown): [number, number][] =>
  Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [[c[0], c[1]]] : Array.isArray(c) ? c.flatMap(positions) : [];

type Bbox = [number, number, number, number];

/** The key of a code in the bbox index. Small areas are indexed by their city. */
const bboxKey = (area: AreaLevel, code: string): string => (area === "small_area" ? code.slice(0, 5) : code);

/** Whether the boundary tiles have the code, judged by the bbox index. Without an index every code counts. */
const knownCode = (area: AreaLevel, code: string, index: Record<string, Bbox> | null): boolean =>
  index === null || ((area !== "small_area" || code.length === 9 || code.length === 11) && Object.hasOwn(index, bboxKey(area, code)));

/** Whether a row can be put on the map: it has a position, a geometry, or an area code the boundary tiles have. */
const isPlaced = (layer: MapLayer, row: Record<string, unknown>, index: Record<string, Bbox> | null): boolean => {
  if ("lng" in layer) return positionOf(row, layer) !== null;
  if ("geometry" in layer) return rowParts(row, layer.geometry).length > 0;
  const code = areaCode(layer.area, row[layer.code]);
  return code !== null && knownCode(layer.area, code, index);
};

/** How the layer's rows are drawn: geometries with any line as lines, only points as points, others as areas. */
export const layerKind = (layer: MapLayer, rows: Rows): LayerKind => {
  if ("lng" in layer) return "point";
  if ("area" in layer) return "fill";
  const all = rows.flatMap((r) => rowGeometries(r, layer.geometry));
  return all.some(isLine) ? "line" : all.length > 0 && all.every(isPoint) ? "point" : "fill";
};

/** Line widths in pixels: fixed, or from thin to thick along the ramp when the lines are colored by numbers. */
const LINE_WIDTH = { fixed: 3, min: 1, max: 5 };

/** Where the layer stands among the layers drawn together, for its color without a color column. */
type LayerContext = { index?: number; locale?: string; bbox?: Record<string, Bbox> | null };

/** The colors, ramp positions and legend of a layer's rows. */
const layerColors = (layer: MapLayer, rows: Rows, { index = 0, locale, bbox = null }: LayerContext) => {
  const ramp = layer.palette ? PALETTES[layer.palette] : layerKind(layer, rows) === "line" ? LINE_RAMP : DEFAULT_RAMP;
  const fixed = layer.palette ? PALETTES[layer.palette][1] : LAYER_COLORS[index % LAYER_COLORS.length];
  return { fixed, ...colorScale(rows, layer.color, (i) => isPlaced(layer, rows[i], bbox), { scale: layer.scale, ramp, fixed, locale }) };
};

/** Points as GeoJSON. Rows without a valid position are left out. A feature's `row` is the index of its row. */
export const pointFeatures = (rows: Rows, layer: MapLayer & { lng: string; lat: string }, context: LayerContext = {}): GeoJSON.FeatureCollection => {
  const { colors } = layerColors(layer, rows, context);
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) => {
      const position = positionOf(r, layer);
      if (position === null) return [];
      return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: position }, properties: { color: colors[i], hover: hoverLines(r, layer, context.locale).join("\n"), row: i } }];
    }),
  };
};

/**
 * Geometries as GeoJSON. Rows without a geometry are left out. A feature's `row` is the index of its row; lines
 * colored by numbers have a `width`, and arrowheads have `head`.
 */
export const geometryFeatures = (rows: Rows, layer: MapLayer & { geometry: string }, context: LayerContext = {}): GeoJSON.FeatureCollection => {
  const { colors, positions: at } = layerColors(layer, rows, context);
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) =>
      rowParts(r, layer.geometry).map(({ geometry, head }) => ({
        type: "Feature" as const,
        geometry,
        properties: {
          color: colors[i],
          hover: hoverLines(r, layer, context.locale).join("\n"),
          row: i,
          ...(at && { width: LINE_WIDTH.min + (LINE_WIDTH.max - LINE_WIDTH.min) * at[i] }),
          ...(head && { head: true }),
        },
      })),
    ),
  };
};

/**
 * Color and hover lines by area code. The first row of a code wins. Codes that the bbox `index` does not have
 * are left out, and do not count toward the color range.
 */
export const areaRows = (
  rows: Rows,
  layer: MapLayer & { area: AreaLevel; code: string },
  index: Record<string, Bbox> | null = null,
  context: LayerContext = {},
): Map<string, { color: string; hover: string }> => {
  const codes = rows.map((r) => areaCode(layer.area, r[layer.code]));
  const known = rows.map((r) => isPlaced(layer, r, index));
  const { colors } = layerColors(layer, rows, { ...context, bbox: index });
  const out = new Map<string, { color: string; hover: string }>();
  rows.forEach((r, i) => {
    const code = codes[i];
    if (code !== null && known[i] && !out.has(code)) out.set(code, { color: colors[i], hover: hoverLines(r, layer, context.locale).join("\n") });
  });
  return out;
};

/** The legend of the rows that are placed on the map. */
export const legendOf = (layer: MapLayer, rows: Rows, index: Record<string, Bbox> | null, context: LayerContext = {}): Legend | null =>
  layerColors(layer, rows, { ...context, bbox: index }).legend;

/**
 * Thrown by renderMap when there are rows but none of them can be put on the map, such as area codes that
 * match no boundary or rows without a position. The message names the columns, so the SQL can be fixed.
 */
export class MapPlacementError extends Error {
  override name = "MapPlacementError";
}

const union = (boxes: Bbox[]): Bbox | null =>
  boxes.length === 0
    ? null
    : boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

const bboxIndexes = new Map<string, Promise<Record<string, Bbox>>>();

/** The bbox index at the URL, fetched once per page. */
const bboxIndex = (url: string): Promise<Record<string, Bbox>> => {
  const found = bboxIndexes.get(url);
  if (found) return found;
  const p = fetchFrom(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.json() as Promise<Record<string, Bbox>>;
    })
    .catch((e: unknown) => {
      bboxIndexes.delete(url);
      throw e;
    });
  bboxIndexes.set(url, p);
  return p;
};

/** The bbox index of the style's boundary tiles, or null when the style has none or it fails to load. */
const styleBboxIndex = async (map: MapLibreMap): Promise<Record<string, Bbox> | null> => {
  const url = (map.getStyle().metadata as Record<string, unknown> | undefined)?.["queria:bbox"];
  return typeof url === "string" ? bboxIndex(url).catch(() => null) : null;
};

const pointBox = ([lng, lat]: [number, number]): Bbox => [lng, lat, lng, lat];

/** The bounds of the points or geometries, or of the areas from the bbox index (small areas use their city). */
export const boundsOf = (layer: MapLayer, rows: Rows, codes: string[], index: Record<string, Bbox> | null): Bbox | null => {
  if ("lng" in layer) return union(rows.flatMap((r) => [positionOf(r, layer)].filter((p) => p !== null).map(pointBox)));
  if ("geometry" in layer) return union(rows.flatMap((r) => rowGeometries(r, layer.geometry).flatMap((g) => positions(g.coordinates))).map(pointBox));
  if (index === null) return null;
  return union(codes.flatMap((c): Bbox[] => {
    const box = index[bboxKey(layer.area, c)];
    return box ? [box] : [];
  }));
};

/** maplibre-gl's stylesheet for a version, from the CDN that serves the package. */
export const maplibreCss = (version: string): string => `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl.css`;

/** Whether a stylesheet of the page already styles the map, such as maplibre-gl's CSS bundled into the app. */
const pageHasMapCss = (): boolean =>
  [...document.styleSheets].some((sheet) => {
    try {
      return [...sheet.cssRules].some((r) => r instanceof CSSStyleRule && r.selectorText.includes(".maplibregl-map"));
    } catch {
      // Rules of a stylesheet from another origin cannot be read.
      return false;
    }
  });

/** Link maplibre-gl's stylesheet once, unless the page has it already. Without it the map's controls and popups break. */
const linkCss = (version: string): void => {
  if (document.querySelector('link[href*="maplibre-gl"]') || pageHasMapCss()) return;
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: maplibreCss(version) }));
};

type Maplibre = typeof import("maplibre-gl");

/**
 * maplibre-gl's exports. Version 6 is an ES module with named exports only; version 5 is UMD and has them
 * on the default export.
 */
export const loadMaplibre = async (): Promise<Maplibre> => {
  const m: Maplibre & { default?: Maplibre } = await import("maplibre-gl");
  return typeof m.Map === "function" ? m : (m.default ?? m);
};

/**
 * The id of the layer that draws the rows. Listen to it for clicks: `map.on("click", ROWS_LAYER, ...)`.
 * Geometries add `${ROWS_LAYER}-line` and `${ROWS_LAYER}-point`. A feature's `code` property is its area code;
 * for points and geometries, its `row` property is the index of its row.
 */
export const ROWS_LAYER = "queria-rows";

/**
 * Rows to add to a map as one layer. `id` names its MapLibre layers, `queria-rows-<n>` by default. `index` picks the
 * color of a layer without a color column, by default its position in the list; pass the position among all the
 * layers so that hiding one does not change the colors of the others.
 */
export type MapLayerRows = { layer: MapLayer; rows: Rows; id?: string; index?: number };

/** A layer added by addMapLayers. `error` says why no row could be placed; such a layer is not drawn. */
export type AddedMapLayer = LegendEntry & { id: string; error: string | null };

export type AddMapLayersOptions = {
  /**
   * Add the layers under these layers of the map: areas under `fill`, lines and points under `point`. By default
   * areas go under the first label of the base map, so place names stay readable, and lines and points on top.
   */
  below?: { fill?: string; point?: string };
  /** The language of numbers on the legend and on hover. By default the page's `lang`. */
  locale?: string;
};

const ORDER: Record<LayerKind, number> = { fill: 0, line: 1, point: 2 };
const POLYGON: FilterSpecification = ["all", ["==", "$type", "Polygon"], ["!has", "head"]];
const HEAD: FilterSpecification = ["all", ["==", "$type", "Polygon"], ["has", "head"]];

/**
 * Add rows to a MapLibre map whose style has loaded, such as a map with layers of its own. Each entry becomes one
 * layer, colored and shown on hover like renderMap's; areas go under lines and lines under points. Areas need the
 * boundary sources of Queria's style (`queria-<level>`). Returns what the legend shows for each layer, the bounds
 * of all the rows, and a function that removes the layers. The legend is not drawn: pass the layers to
 * legendElement.
 */
export const addMapLayers = async (
  map: MapLibreMap,
  entries: MapLayerRows[],
  { below = {}, locale = map.getContainer().closest("[lang]")?.getAttribute("lang") || undefined }: AddMapLayersOptions = {},
): Promise<{ layers: AddedMapLayer[]; bounds: Bbox | null; remove: () => void }> => {
  const maplibregl = await loadMaplibre();
  const index = entries.some((e) => "area" in e.layer) ? await styleBboxIndex(map) : null;
  const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  const [fillBelow, pointBelow] = [below.fill ?? firstLabel, below.point];
  const added: string[] = [];
  const sources: string[] = [];
  const hovers = new Map<string, (f: { properties: Record<string, unknown> }) => string | undefined>();
  const boxes: Bbox[] = [];
  const addLayer = (spec: LayerSpecification, before: string | undefined, hover?: (f: { properties: Record<string, unknown> }) => string | undefined) => {
    map.addLayer(spec, before && map.getLayer(before) ? before : undefined);
    added.push(spec.id);
    if (hover) hovers.set(spec.id, hover);
  };
  const byProperty = (f: { properties: Record<string, unknown> }) => f.properties.hover as string | undefined;
  const layers = entries.map(({ layer, rows, ...entry }, i): AddedMapLayer & { add: () => void } => {
    const id = entry.id ?? `${ROWS_LAYER}-${i}`;
    const context = { index: entry.index ?? i, locale };
    const kind = layerKind(layer, rows);
    const { fixed, legend } = layerColors(layer, rows, { ...context, bbox: index });
    const base = { id, name: layer.name, kind, color: fixed, legend: layer.legend === false ? null : legend, ...(layer.legend === false && { hidden: true }) };
    const opacity = layer.opacity ?? (kind === "fill" ? 0.6 : 0.9);
    const fail = (error: string) => ({ ...base, error, add: () => {} });
    if ("area" in layer) {
      const source = boundarySource(layer.area);
      if (!map.getSource(source)) throw new Error(`The map style has no source "${source}". Use Queria's style to draw areas`);
      const areas = areaRows(rows, layer, index, context);
      const codes = [...areas.keys()];
      if (codes.length === 0) return rows.length > 0 ? fail(`No value of "${layer.code}" matched a ${layer.area} code`) : { ...base, error: null, add: () => {} };
      const box = boundsOf(layer, rows, codes, index);
      if (box) boxes.push(box);
      return {
        ...base,
        error: null,
        add: () =>
          addLayer(
            {
              id,
              type: "fill",
              source,
              "source-layer": layer.area,
              // A match on a literal list is a lookup table; "in" would scan the list for every feature.
              filter: ["match", ["get", "code"], codes, true, false],
              paint: {
                "fill-color": ["match", ["get", "code"], ...[...areas].flatMap(([c, a]) => [c, a.color]), "rgba(0,0,0,0)"] as unknown as string,
                "fill-opacity": opacity,
                "fill-outline-color": "#ffffff",
              },
            },
            fillBelow,
            (f) => areas.get(String(f.properties.code))?.hover,
          ),
      };
    }
    const data = "lng" in layer ? pointFeatures(rows, layer, context) : geometryFeatures(rows, layer, context);
    if (rows.length > 0 && data.features.length === 0)
      return fail("lng" in layer ? `No row has numbers in both "${layer.lng}" and "${layer.lat}"` : `No row has a GeoJSON geometry in the column "${layer.geometry}"`);
    const box = boundsOf(layer, rows, [], null);
    if (box) boxes.push(box);
    const point = (pointId: string): CircleLayerSpecification => ({
      id: pointId,
      type: "circle",
      source: id,
      filter: ["==", "$type", "Point"],
      paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": opacity, "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" },
    });
    const width: ExpressionSpecification = ["coalesce", ["get", "width"], LINE_WIDTH.fixed];
    const lines: FilterSpecification = ["==", "$type", "LineString"];
    const round = { "line-cap": "round", "line-join": "round" } as const;
    return {
      ...base,
      error: null,
      add: () => {
        map.addSource(id, { type: "geojson", data });
        sources.push(id);
        if ("lng" in layer) {
          addLayer(point(id), pointBelow, byProperty);
          return;
        }
        addLayer({ id, type: "fill", source: id, filter: POLYGON, paint: { "fill-color": ["get", "color"], "fill-opacity": opacity, "fill-outline-color": "#ffffff" } }, fillBelow, byProperty);
        // A white casing lifts the lines off the base map.
        addLayer({ id: `${id}-casing`, type: "line", source: id, filter: lines, layout: round, paint: { "line-color": "#ffffff", "line-width": ["+", width, 2], "line-opacity": 0.8 } }, pointBelow);
        addLayer({ id: `${id}-line`, type: "line", source: id, filter: lines, layout: round, paint: { "line-color": ["get", "color"], "line-width": width, "line-opacity": opacity } }, pointBelow, byProperty);
        addLayer({ id: `${id}-head`, type: "fill", source: id, filter: HEAD, paint: { "fill-color": ["get", "color"] } }, pointBelow, byProperty);
        addLayer(point(`${id}-point`), pointBelow, byProperty);
      },
    };
  });
  // Areas first, then lines, then points, so that points stay on top.
  [...layers].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).forEach((l) => l.add());

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  // Touch screens send no mousemove, so a tap shows the same lines.
  const show = (e: MapLayerMouseEvent): void => {
    const f = e.features?.[0];
    const text = f ? hovers.get(f.layer.id)?.(f) : undefined;
    if (!text) {
      popup.remove();
      return;
    }
    // The text comes from the data, so it is set as text, never as HTML. The popup is white in either theme.
    const body = div("white-space:pre-line;font-size:12px;line-height:1.4;color:#171717", text);
    popup.setLngLat(e.lngLat).setDOMContent(body).addTo(map);
  };
  const leave = () => popup.remove();
  const ids = [...hovers.keys()];
  ids.forEach((id) => {
    map.on("mousemove", id, show);
    map.on("click", id, show);
    map.on("mouseleave", id, leave);
  });
  return {
    layers: layers.map(({ add: _, ...l }) => l),
    bounds: union(boxes),
    remove: () => {
      popup.remove();
      ids.forEach((id) => {
        map.off("mousemove", id, show);
        map.off("click", id, show);
        map.off("mouseleave", id, leave);
      });
      [...added].reverse().forEach((id) => map.getLayer(id) && map.removeLayer(id));
      sources.forEach((id) => map.getSource(id) && map.removeSource(id));
    },
  };
};

export type MapRenderOptions = {
  /** A MapLibre style or its URL. By default Queria's style, which has the boundary tiles. */
  style?: StyleSpecification | string;
  /** Queria's light or dark style. By default, dark when the element's text color is light. */
  theme?: keyof typeof MAP_STYLES;
  /**
   * Zoom with Ctrl (⌘ on a Mac) and the wheel, and pan with two fingers, so that the page scrolls past the map.
   * Off by default.
   */
  cooperativeGestures?: boolean;
  /** The language of numbers on the legend and on hover. By default the page's `lang`. */
  locale?: string;
};

/**
 * Draw rows on a MapLibre map. maplibre-gl and its stylesheet are loaded on first use.
 * The map is fitted to the rows. It returns once the rows are added, before the base map's tiles have loaded.
 * Sources and licenses are not drawn here; the elements and React components add them.
 * Throws a MapPlacementError when there are rows but none can be placed.
 */
export const renderMap = async (
  el: HTMLElement,
  layer: MapLayer,
  rows: Rows,
  { style, theme, cooperativeGestures = false, locale = el.closest("[lang]")?.getAttribute("lang") || undefined }: MapRenderOptions = {},
): Promise<{ map: MapLibreMap; finalize: () => void }> => {
  const maplibregl = await loadMaplibre();
  linkCss(maplibregl.getVersion());
  const tone = theme ?? toneOf(getComputedStyle(el).color);
  const map = new maplibregl.Map({ container: el, style: style ?? MAP_STYLES[tone], center: [137, 37], zoom: 4, cooperativeGestures });
  let added: AddedMapLayer | undefined;
  try {
    // An error before the style loads stops the map. Later errors, such as a tile or a sprite that fails to
    // load, leave it drawing, and MapLibre logs them once no listener is left.
    await new Promise<void>((resolve, reject) => {
      const fail = (e: { error: Error }) => reject(e.error);
      map.on("error", fail);
      map.once("style.load", () => {
        map.off("error", fail);
        resolve();
      });
    });
    const { layers, bounds } = await addMapLayers(map, [{ layer, rows, id: ROWS_LAYER }], { locale });
    added = layers[0];
    if (added.error) throw new MapPlacementError(added.error);
    if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
  } catch (e) {
    map.remove();
    throw e;
  }
  const legendEl = added ? legendElement(added, tone, { locale }) : null;
  if (legendEl) el.appendChild(legendEl);
  return {
    map,
    finalize: () => {
      legendEl?.remove();
      map.remove();
    },
  };
};
