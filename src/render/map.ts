import type { Map, MapOptions, StyleSpecification } from "maplibre-gl";

export type MapHandle = { map: Promise<Map>; destroy: () => void };

/** Create a MapLibre map in an element. maplibre-gl is loaded on first use; include its CSS in your page. */
export const mountMap = (
  el: HTMLElement,
  style: StyleSpecification | string,
  options: Omit<MapOptions, "container" | "style"> = {},
): MapHandle => {
  const map = import("maplibre-gl").then(
    ({ default: maplibregl }) => new maplibregl.Map({ container: el, style, ...options }),
  );
  const destroy = () => {
    map.then((m) => m.remove(), console.error);
  };
  return { map, destroy };
};
