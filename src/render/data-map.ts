import type { GeoJSONSourceSpecification, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import { type Rows, toneOf } from "./chart.js";
import { BASE, CATEGORIES } from "./palette.js";
import { fetchFrom } from "../fetch.js";

export type AreaLevel = "prefecture" | "city" | "small_area";

/**
 * How rows are put on the map: by area code (the shapes come from Queria's boundary tiles) or by longitude and latitude.
 * The values are column names. `color` colors by a column, `label` names a row on hover or tap.
 */
export type MapLayer = ({ area: AreaLevel; code: string } | { lng: string; lat: string }) & {
  color?: string;
  label?: string;
  opacity?: number;
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

const LOW = [219, 234, 254];
const HIGH = [29, 78, 216];

const hex = (rgb: number[]): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** What the colors mean: a range of numbers, or one color per value. */
export type Legend =
  | { column: string; min: number; max: number }
  | { column: string; items: { label: string; color: string }[]; more: number };

/**
 * A color for each row, and the legend. Numbers run from light to dark between the smallest and largest value;
 * other values get one color each, in order of first appearance.
 */
export const colorScale = (rows: Rows, column: string | undefined): { colors: string[]; legend: Legend | null } => {
  if (column === undefined) return { colors: rows.map(() => BASE), legend: null };
  const values = rows.map((r) => r[column]);
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length > 0 && nums.length === values.filter((v) => v !== null && v !== undefined).length) {
    // Spreading a large array into Math.min overflows the stack.
    const min = nums.reduce((a, b) => Math.min(a, b));
    const max = nums.reduce((a, b) => Math.max(a, b));
    const colors = values.map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "#d4d4d4";
      const t = max === min ? 1 : (v - min) / (max - min);
      return hex(LOW.map((l, i) => l + (HIGH[i] - l) * t));
    });
    return { colors, legend: { column, min, max } };
  }
  const order = [...new Set(values.map(String))];
  const colorOf = (label: string): string => CATEGORIES[order.indexOf(label) % CATEGORIES.length];
  return {
    colors: values.map((v) => colorOf(String(v))),
    // Colors repeat after the tenth value, so the legend lists the first ten.
    legend: { column, items: order.slice(0, CATEGORIES.length).map((label) => ({ label, color: colorOf(label) })), more: Math.max(0, order.length - CATEGORIES.length) },
  };
};

const div = (style: string, text = ""): HTMLDivElement => Object.assign(document.createElement("div"), { textContent: text, style: style });

/** The legend drawn over the map's top left corner. Labels come from the data, so they are set as text. */
export const legendElement = (legend: Legend, theme: "light" | "dark"): HTMLElement => {
  const box = div(
    `position:absolute;top:8px;left:8px;z-index:2;max-width:45%;padding:6px 8px;border-radius:4px;font:12px/1.4 sans-serif;${theme === "dark" ? "background:rgba(23,23,23,.85);color:#e5e5e5" : "background:rgba(255,255,255,.9);color:#262626"}`,
  );
  box.className = "queria-legend";
  box.append(div("font-weight:600;margin-bottom:2px", legend.column));
  if ("min" in legend) {
    box.append(
      div(`width:120px;height:8px;border-radius:2px;background:linear-gradient(to right,${hex(LOW)},${hex(HIGH)})`),
      div("display:flex;justify-content:space-between;gap:8px", ""),
    );
    box.lastElementChild?.append(div("", legend.min.toLocaleString()), div("", legend.max.toLocaleString()));
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
export const pointFeatures = (rows: Rows, layer: MapLayer & { lng: string; lat: string }): GeoJSONSourceSpecification["data"] => {
  const { colors } = colorScale(rows, layer.color);
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) => {
      const position = positionOf(r, layer);
      if (position === null) return [];
      return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: position }, properties: { color: colors[i], hover: hoverLines(r, layer).join("\n") } }];
    }),
  };
};

/** Color and hover lines by area code. The first row of a code wins. */
export const areaRows = (rows: Rows, layer: MapLayer & { area: AreaLevel; code: string }): Map<string, { color: string; hover: string }> => {
  const { colors } = colorScale(rows, layer.color);
  const out = new Map<string, { color: string; hover: string }>();
  rows.forEach((r, i) => {
    const code = areaCode(layer.area, r[layer.code]);
    if (code !== null && !out.has(code)) out.set(code, { color: colors[i], hover: hoverLines(r, layer).join("\n") });
  });
  return out;
};

type Bbox = [number, number, number, number];

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

/** The bounds of the points, or of the areas from the style's bbox index (small areas use their city). */
const boundsOf = async (map: MapLibreMap, layer: MapLayer, rows: Rows, codes: string[]): Promise<Bbox | null> => {
  if ("lng" in layer) {
    return union(rows.flatMap((r): Bbox[] => {
      const p = positionOf(r, layer);
      return p ? [[p[0], p[1], p[0], p[1]]] : [];
    }));
  }
  const url = (map.getStyle().metadata as Record<string, unknown> | undefined)?.["queria:bbox"];
  if (typeof url !== "string") return null;
  const index = await bboxIndex(url);
  return union(codes.flatMap((c): Bbox[] => {
      const box = index[layer.area === "small_area" ? c.slice(0, 5) : c];
      return box ? [box] : [];
    }));
};

/** maplibre-gl's stylesheet for a version, from the CDN that serves the package. */
export const maplibreCss = (version: string): string => `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl.css`;

/** Link maplibre-gl's stylesheet once, unless the page links one already. Without it the map's controls and popups break. */
const linkCss = (version: string): void => {
  if (document.querySelector('link[href*="maplibre-gl"]')) return;
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

export type MapRenderOptions = {
  /** A MapLibre style or its URL. By default Queria's style, which has the boundary tiles. */
  style?: StyleSpecification | string;
  /** Queria's light or dark style. By default, dark when the element's text color is light. */
  theme?: keyof typeof MAP_STYLES;
};

/**
 * Draw rows on a MapLibre map. maplibre-gl and its stylesheet are loaded on first use.
 * The map is fitted to the rows. Sources and licenses are not drawn here; the elements and React components add them.
 */
export const renderMap = async (
  el: HTMLElement,
  layer: MapLayer,
  rows: Rows,
  { style, theme }: MapRenderOptions = {},
): Promise<{ map: MapLibreMap; finalize: () => void }> => {
  const maplibregl = await loadMaplibre();
  linkCss(maplibregl.getVersion());
  const tone = theme ?? toneOf(getComputedStyle(el).color);
  const map = new maplibregl.Map({ container: el, style: style ?? MAP_STYLES[tone], center: [137, 37], zoom: 4 });
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
    let codes: string[] = [];
    let hover: (f: { properties: Record<string, unknown> }) => string | undefined;
    if ("lng" in layer) {
      map.addSource("queria-rows", { type: "geojson", data: pointFeatures(rows, layer) });
      map.addLayer({
        id: "queria-rows",
        type: "circle",
        source: "queria-rows",
        paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": opacity, "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" },
      });
      hover = (f) => f.properties.hover as string | undefined;
    } else {
      const source = boundarySource(layer.area);
      if (!map.getSource(source)) throw new Error(`The map style has no source "${source}". Use Queria's style to draw areas`);
      const areas = areaRows(rows, layer);
      codes = [...areas.keys()];
      if (codes.length > 0)
        map.addLayer({
          id: "queria-rows",
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
    map.on("mousemove", "queria-rows", show);
    map.on("click", "queria-rows", show);
    map.on("mouseleave", "queria-rows", () => popup.remove());
    const bounds = await boundsOf(map, layer, rows, codes).catch(() => null);
    if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
  } catch (e) {
    map.remove();
    throw e;
  }
  const { legend } = colorScale(rows, layer.color);
  const legendEl = legend && layer.legend !== false ? el.appendChild(legendElement(legend, tone)) : null;
  return {
    map,
    finalize: () => {
      legendEl?.remove();
      map.remove();
    },
  };
};
