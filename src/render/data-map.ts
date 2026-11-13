import type { Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import { type Rows, toneOf } from "./chart.js";
import { BASE, RAMP, SERIES } from "./palette.js";
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
  /** The layer's name, shown as the legend's title instead of the column name. */
  name?: string;
  /** Show what the colors mean. On by default when `color` is set. */
  legend?: boolean;
};

/** Queria's map styles. They keep their URL when the tiles are rebuilt, and hold the boundary sources. */
export const MAP_STYLES = {
  light: "https://assets.queria.io/maps/v1/light.json",
  dark: "https://assets.queria.io/maps/v1/dark.json",
} as const;

/** The style's source for each area level. */
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

const [LOW, HIGH] = RAMP;

const hex = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/**
 * What the colors mean: a range of numbers, or one color per value. `mid` is the value at the middle of the ramp
 * when the numbers are colored on a log scale.
 */
export type Legend =
  | { column: string; min: number; max: number; mid?: number }
  | { column: string; items: { label: string; color: string }[]; more: number };

/**
 * Whether to color positive numbers on a log scale: when the largest is at least ten times the smallest and the
 * median falls in the lightest fifth of a linear ramp, so that half of the rows would look the same.
 */
const isSkewed = (sorted: number[]): boolean => {
  const [min, max, median] = [sorted[0], sorted[sorted.length - 1], sorted[sorted.length >> 1]];
  return min > 0 && max >= min * 10 && (median - min) / (max - min) < 0.2;
};

/**
 * A color for each row, and the legend. Numbers run from light to dark between the smallest and largest value,
 * on a log scale when a few values are far larger than the rest; other values get one color each, in order of
 * first appearance. Only the rows that are `placed` on the map count, so a total row without a shape does not
 * stretch the range.
 */
export const colorScale = (
  rows: Rows,
  column: string | undefined,
  placed: (i: number) => boolean = () => true,
): { colors: string[]; legend: Legend | null } => {
  if (column === undefined) return { colors: rows.map(() => BASE), legend: null };
  const values = rows.map((r) => r[column]);
  const shown = values.filter((v, i) => placed(i) && v !== null && v !== undefined);
  const nums = shown.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length > 0 && nums.length === shown.length) {
    const sorted = nums.sort((a, b) => a - b);
    const [min, max] = [sorted[0], sorted[sorted.length - 1]];
    const log = isSkewed(sorted);
    const at = log ? Math.log : (v: number) => v;
    const t = (v: number) => (max === min ? 1 : Math.min(1, Math.max(0, (at(v) - at(min)) / (at(max) - at(min)))));
    const colors = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? hex(LOW.map((l, i) => l + (HIGH[i] - l) * t(v))) : "#d4d4d4"));
    return { colors, legend: { column, min, max, ...(log && { mid: Math.sqrt(min * max) }) } };
  }
  const order = [...new Set(values.filter((_, i) => placed(i)).map(String))];
  const colorOf = (label: string): string => SERIES[order.indexOf(label) % SERIES.length];
  return {
    colors: values.map((v) => colorOf(String(v))),
    // Colors repeat after the tenth value, so the legend lists the first ten.
    legend: { column, items: order.slice(0, SERIES.length).map((label) => ({ label, color: colorOf(label) })), more: Math.max(0, order.length - SERIES.length) },
  };
};

const div = (style: string, text = ""): HTMLDivElement => Object.assign(document.createElement("div"), { textContent: text, style: style });

/**
 * The legend drawn over the map's top left corner, titled with the layer's name or else the column.
 * Labels come from the data, so they are set as text.
 */
export const legendElement = (legend: Legend, theme: "light" | "dark", name?: string): HTMLElement => {
  const box = div(
    `position:absolute;top:8px;left:8px;z-index:2;max-width:45%;padding:6px 8px;border-radius:4px;font:12px/1.4 sans-serif;${theme === "dark" ? "background:rgba(23,23,23,.85);color:#e5e5e5" : "background:rgba(255,255,255,.9);color:#262626"}`,
  );
  box.className = "queria-legend";
  box.append(div("font-weight:600;margin-bottom:2px", name ?? legend.column));
  if ("min" in legend) {
    box.append(
      div(`width:120px;height:8px;border-radius:2px;background:linear-gradient(to right,${hex(LOW)},${hex(HIGH)})`),
      div("display:flex;justify-content:space-between;gap:8px", ""),
    );
    // On a log scale the middle value shows that colors are not proportional to the values.
    const mid = legend.mid === undefined ? [] : [div("", legend.mid.toLocaleString(undefined, { maximumSignificantDigits: 2 }))];
    box.lastElementChild?.append(div("", legend.min.toLocaleString()), ...mid, div("", legend.max.toLocaleString()));
    return box;
  }
  legend.items.forEach(({ label, color }) => {
    const item = div("display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis");
    item.append(div(`flex:none;width:10px;height:10px;border-radius:2px;background:${color}`), label);
    box.append(item);
  });
  if (legend.more > 0) box.append(div("", `+${legend.more}`));
  return box;
};

/** Lines shown on hover: the label, then the colored value. */
const hoverLines = (row: Record<string, unknown>, layer: MapLayer): string[] =>
  [
    layer.label === undefined ? null : String(row[layer.label] ?? ""),
    layer.color === undefined ? null : `${layer.color}: ${typeof row[layer.color] === "number" ? (row[layer.color] as number).toLocaleString() : String(row[layer.color])}`,
  ].filter((l): l is string => !!l);

const coordinate = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;

/** The row's [lng, lat], or null when either is missing or not a number. */
const positionOf = (row: Record<string, unknown>, layer: { lng: string; lat: string }): [number, number] | null => {
  const [lng, lat] = [coordinate(row[layer.lng]), coordinate(row[layer.lat])];
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
};

/** Points as GeoJSON. Rows without a valid position are left out. */
export const pointFeatures = (rows: Rows, layer: MapLayer & { lng: string; lat: string }): GeoJSON.FeatureCollection => {
  const { colors } = colorScale(rows, layer.color, (i) => isPlaced(layer, rows[i], null));
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) => {
      const position = positionOf(r, layer);
      if (position === null) return [];
      return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: position }, properties: { color: colors[i], hover: hoverLines(r, layer).join("\n") } }];
    }),
  };
};

type Geometry = Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The simple geometries in a value: a GeoJSON geometry as text or an object. Geometry collections are split. */
export const geometriesOf = (value: unknown): Geometry[] => {
  const g = typeof value === "string" ? parseJson(value) : value;
  if (g === null || typeof g !== "object" || !("type" in g)) return [];
  if (g.type === "GeometryCollection" && "geometries" in g && Array.isArray(g.geometries)) return g.geometries.flatMap(geometriesOf);
  return "coordinates" in g && Array.isArray(g.coordinates) ? [g as Geometry] : [];
};

/** Geometries as GeoJSON. Rows without a geometry are left out. A feature's `row` is the index of its row. */
export const geometryFeatures = (rows: Rows, layer: MapLayer & { geometry: string }): GeoJSON.FeatureCollection => {
  const { colors } = colorScale(rows, layer.color, (i) => isPlaced(layer, rows[i], null));
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) =>
      geometriesOf(r[layer.geometry]).map((geometry) => ({ type: "Feature" as const, geometry, properties: { color: colors[i], hover: hoverLines(r, layer).join("\n"), row: i } })),
    ),
  };
};

/** Every [lng, lat] in nested coordinates. */
const positions = (c: unknown): [number, number][] =>
  Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [[c[0], c[1]]] : Array.isArray(c) ? c.flatMap(positions) : [];

type Bbox = [number, number, number, number];

/** The key of a code in the bbox index. Small areas are indexed by their city. */
const bboxKey = (area: AreaLevel, code: string): string => (area === "small_area" ? code.slice(0, 5) : code);

/** Whether the boundary tiles have the code, judged by the bbox index. Without an index every code counts. */
const knownCode = (area: AreaLevel, code: string, index: Record<string, Bbox> | null): boolean =>
  index === null || ((area !== "small_area" || code.length === 9 || code.length === 11) && Object.hasOwn(index, bboxKey(area, code)));

/**
 * Color and hover lines by area code. The first row of a code wins. Codes that the bbox `index` does not have
 * are left out, and do not count toward the color range.
 */
export const areaRows = (
  rows: Rows,
  layer: MapLayer & { area: AreaLevel; code: string },
  index: Record<string, Bbox> | null = null,
): Map<string, { color: string; hover: string }> => {
  const codes = rows.map((r) => areaCode(layer.area, r[layer.code]));
  const known = rows.map((r) => isPlaced(layer, r, index));
  const { colors } = colorScale(rows, layer.color, (i) => known[i]);
  const out = new Map<string, { color: string; hover: string }>();
  rows.forEach((r, i) => {
    const code = codes[i];
    if (code !== null && known[i] && !out.has(code)) out.set(code, { color: colors[i], hover: hoverLines(r, layer).join("\n") });
  });
  return out;
};

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
  if ("geometry" in layer) return union(rows.flatMap((r) => geometriesOf(r[layer.geometry]).flatMap((g) => positions(g.coordinates))).map(pointBox));
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

/** Whether a row can be put on the map: it has a position, a geometry, or an area code the boundary tiles have. */
const isPlaced = (layer: MapLayer, row: Record<string, unknown>, index: Record<string, Bbox> | null): boolean => {
  if ("lng" in layer) return positionOf(row, layer) !== null;
  if ("geometry" in layer) return geometriesOf(row[layer.geometry]).length > 0;
  const code = areaCode(layer.area, row[layer.code]);
  return code !== null && knownCode(layer.area, code, index);
};

/** The legend of the rows that are placed on the map. */
export const legendOf = (layer: MapLayer, rows: Rows, index: Record<string, Bbox> | null): Legend | null =>
  colorScale(rows, layer.color, (i) => isPlaced(layer, rows[i], index)).legend;

/**
 * The id of the layer that draws the rows. Listen to it for clicks: `map.on("click", ROWS_LAYER, ...)`.
 * Geometries add `${ROWS_LAYER}-line` and `${ROWS_LAYER}-point`. A feature's `code` property is its area code;
 * for geometries, its `row` property is the index of its row.
 */
export const ROWS_LAYER = "queria-rows";

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
};

/**
 * Draw rows on a MapLibre map. maplibre-gl and its stylesheet are loaded on first use.
 * The map is fitted to the rows. Sources and licenses are not drawn here; the elements and React components add them.
 * Throws a MapPlacementError when there are rows but none can be placed.
 */
export const renderMap = async (
  el: HTMLElement,
  layer: MapLayer,
  rows: Rows,
  { style, theme, cooperativeGestures = false }: MapRenderOptions = {},
): Promise<{ map: MapLibreMap; finalize: () => void }> => {
  const maplibregl = await loadMaplibre();
  linkCss(maplibregl.getVersion());
  const tone = theme ?? toneOf(getComputedStyle(el).color);
  const map = new maplibregl.Map({ container: el, style: style ?? MAP_STYLES[tone], center: [137, 37], zoom: 4, cooperativeGestures });
  let legend: Legend | null;
  try {
    // An error before the style loads stops the map. Later errors, such as a tile or a sprite that fails to
    // load, leave it drawing, and MapLibre logs them once no listener is left.
    await new Promise<void>((resolve, reject) => {
      const fail = (e: { error: Error }) => reject(e.error);
      map.on("error", fail);
      map.once("style.load", () => map.off("error", fail));
      map.once("load", () => resolve());
    });
    // Areas go under the first label of the base map, so place names stay readable; points go on top.
    const below = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const opacity = layer.opacity ?? ("lng" in layer ? 0.9 : 0.6);
    const index = "area" in layer ? await styleBboxIndex(map) : null;
    let codes: string[] = [];
    let hover: (f: { properties: Record<string, unknown> }) => string | undefined;
    const hoverLayers = [ROWS_LAYER];
    const unplaced = (data: GeoJSON.FeatureCollection, what: string): GeoJSON.FeatureCollection => {
      if (rows.length > 0 && data.features.length === 0) throw new MapPlacementError(`No row has ${what}`);
      return data;
    };
    if ("geometry" in layer) {
      map.addSource(ROWS_LAYER, { type: "geojson", data: unplaced(geometryFeatures(rows, layer), `a GeoJSON geometry in the column "${layer.geometry}"`) });
      map.addLayer({
        id: ROWS_LAYER,
        type: "fill",
        source: ROWS_LAYER,
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": opacity, "fill-outline-color": "#ffffff" },
      }, below);
      map.addLayer({ id: `${ROWS_LAYER}-line`, type: "line", source: ROWS_LAYER, filter: ["==", "$type", "LineString"], paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": opacity } });
      map.addLayer({
        id: `${ROWS_LAYER}-point`,
        type: "circle",
        source: ROWS_LAYER,
        filter: ["==", "$type", "Point"],
        paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": opacity, "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" },
      });
      hoverLayers.push(`${ROWS_LAYER}-line`, `${ROWS_LAYER}-point`);
      hover = (f) => f.properties.hover as string | undefined;
    } else if ("lng" in layer) {
      map.addSource(ROWS_LAYER, { type: "geojson", data: unplaced(pointFeatures(rows, layer), `numbers in both "${layer.lng}" and "${layer.lat}"`) });
      map.addLayer({
        id: ROWS_LAYER,
        type: "circle",
        source: ROWS_LAYER,
        paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": opacity, "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" },
      });
      hover = (f) => f.properties.hover as string | undefined;
    } else {
      const source = boundarySource(layer.area);
      if (!map.getSource(source)) throw new Error(`The map style has no source "${source}". Use Queria's style to draw areas`);
      const areas = areaRows(rows, layer, index);
      codes = [...areas.keys()];
      if (rows.length > 0 && codes.length === 0) throw new MapPlacementError(`No value of "${layer.code}" matched a ${layer.area} code`);
      if (codes.length > 0)
        map.addLayer({
          id: ROWS_LAYER,
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
        }, below);
      hover = (f) => areas.get(String(f.properties.code))?.hover;
    }
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    // Touch screens send no mousemove, so a tap shows the same lines.
    const show = (e: MapLayerMouseEvent): void => {
      const text = e.features?.[0] ? hover(e.features[0]) : undefined;
      if (!text) {
        popup.remove();
        return;
      }
      // The text comes from the data, so it is set as text, never as HTML.
      const body = document.createElement("div");
      body.style.whiteSpace = "pre-line";
      body.textContent = text;
      popup.setLngLat(e.lngLat).setDOMContent(body).addTo(map);
    };
    hoverLayers.forEach((id) => {
      map.on("mousemove", id, show);
      map.on("click", id, show);
      map.on("mouseleave", id, () => popup.remove());
    });
    const bounds = boundsOf(layer, rows, codes, index);
    if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
    legend = legendOf(layer, rows, index);
  } catch (e) {
    map.remove();
    throw e;
  }
  const legendEl = legend && layer.legend !== false ? el.appendChild(legendElement(legend, tone, layer.name)) : null;
  return {
    map,
    finalize: () => {
      legendEl?.remove();
      map.remove();
    },
  };
};
