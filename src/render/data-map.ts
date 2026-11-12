import type { GeoJSONSourceSpecification, Map, StyleSpecification } from "maplibre-gl";
import type { Rows } from "./chart.js";

export type AreaLevel = "prefecture" | "city" | "small_area";

/**
 * How rows are put on the map: by area code (the shapes come from Queria's boundary tiles) or by longitude and latitude.
 * The values are column names. `color` colors by a column, `label` names a row on hover.
 */
export type MapLayer = ({ area: AreaLevel; code: string } | { lng: string; lat: string }) & {
  color?: string;
  label?: string;
  opacity?: number;
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

const BASE = "#2563eb";
const LOW = [219, 234, 254];
const HIGH = [29, 78, 216];
const CATEGORIES = ["#2563eb", "#ea580c", "#16a34a", "#dc2626", "#9333ea", "#0891b2", "#ca8a04", "#db2777", "#4b5563", "#65a30d"];

const hex = (rgb: number[]): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/**
 * A color for each row. Numbers run from light to dark between the smallest and largest value;
 * other values get one color each, in order of first appearance.
 */
export const colorsOf = (rows: Rows, column: string | undefined): string[] => {
  if (column === undefined) return rows.map(() => BASE);
  const values = rows.map((r) => r[column]);
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length > 0 && nums.length === values.filter((v) => v !== null && v !== undefined).length) {
    const [min, max] = [Math.min(...nums), Math.max(...nums)];
    return values.map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "#d4d4d4";
      const t = max === min ? 1 : (v - min) / (max - min);
      return hex(LOW.map((l, i) => l + (HIGH[i] - l) * t));
    });
  }
  const order = [...new Set(values.map(String))];
  return values.map((v) => CATEGORIES[order.indexOf(String(v)) % CATEGORIES.length]);
};

/** Lines shown on hover: the label, then the colored value. */
const hoverLines = (row: Record<string, unknown>, layer: MapLayer): string[] =>
  [
    layer.label === undefined ? null : String(row[layer.label] ?? ""),
    layer.color === undefined ? null : `${layer.color}: ${typeof row[layer.color] === "number" ? (row[layer.color] as number).toLocaleString() : String(row[layer.color])}`,
  ].filter((l): l is string => !!l);

/** Points as GeoJSON. Rows without a valid position are left out. */
export const pointFeatures = (rows: Rows, layer: MapLayer & { lng: string; lat: string }): GeoJSONSourceSpecification["data"] => {
  const colors = colorsOf(rows, layer.color);
  return {
    type: "FeatureCollection",
    features: rows.flatMap((r, i) => {
      const [lng, lat] = [Number(r[layer.lng]), Number(r[layer.lat])];
      if (r[layer.lng] === null || r[layer.lat] === null || !Number.isFinite(lng) || !Number.isFinite(lat)) return [];
      return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lng, lat] }, properties: { color: colors[i], hover: hoverLines(r, layer).join("\n") } }];
    }),
  };
};

/** Color and hover lines by area code. The first row of a code wins. */
export const areaRows = (rows: Rows, layer: MapLayer & { area: AreaLevel; code: string }): globalThis.Map<string, { color: string; hover: string }> => {
  const colors = colorsOf(rows, layer.color);
  const out = new globalThis.Map<string, { color: string; hover: string }>();
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

/** The bounds of the points, or of the areas from the style's bbox index (small areas use their city). */
const boundsOf = async (map: Map, layer: MapLayer, rows: Rows, codes: string[]): Promise<Bbox | null> => {
  if ("lng" in layer) {
    const pts = rows.map((r) => [Number(r[layer.lng]), Number(r[layer.lat])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    return union(pts.map(([x, y]) => [x, y, x, y]));
  }
  const url = (map.getStyle().metadata as Record<string, unknown> | undefined)?.["queria:bbox"];
  if (typeof url !== "string") return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const index = (await res.json()) as Record<string, Bbox>;
  return union(codes.flatMap((c): Bbox[] => {
      const box = index[layer.area === "small_area" ? c.slice(0, 5) : c];
      return box ? [box] : [];
    }));
};

export type MapRenderOptions = {
  /** A MapLibre style or its URL. By default Queria's style, which has the boundary tiles. */
  style?: StyleSpecification | string;
  theme?: keyof typeof MAP_STYLES;
};

/**
 * Draw rows on a MapLibre map. maplibre-gl is loaded on first use; include its CSS in your page.
 * The map is fitted to the rows. Sources and licenses are not drawn here; the elements and React components add them.
 */
export const renderMap = async (
  el: HTMLElement,
  layer: MapLayer,
  rows: Rows,
  { style, theme = "light" }: MapRenderOptions = {},
): Promise<{ map: Map; finalize: () => void }> => {
  const { default: maplibregl } = await import("maplibre-gl");
  const map = new maplibregl.Map({ container: el, style: style ?? MAP_STYLES[theme], center: [137, 37], zoom: 4 });
  try {
    // A tile that fails to load is reported on the map and does not stop it; a style that fails does.
    await new Promise<void>((resolve, reject) => {
      map.once("load", () => resolve());
      map.on("error", (e: { error: Error; sourceId?: string }) => {
        if (!map.loaded() && e.sourceId === undefined) reject(e.error);
      });
    });
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
        });
      hover = (f) => areas.get(String(f.properties.code))?.hover;
    }
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on("mousemove", "queria-rows", (e) => {
      const text = e.features?.[0] ? hover(e.features[0]) : undefined;
      if (!text) return popup.remove();
      // The text comes from the data, so it is set as text, never as HTML.
      const body = document.createElement("div");
      body.style.whiteSpace = "pre-line";
      body.textContent = text;
      popup.setLngLat(e.lngLat).setDOMContent(body).addTo(map);
    });
    map.on("mouseleave", "queria-rows", () => popup.remove());
    const bounds = await boundsOf(map, layer, rows, codes).catch(() => null);
    if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
  } catch (e) {
    map.remove();
    throw e;
  }
  return { map, finalize: () => map.remove() };
};
