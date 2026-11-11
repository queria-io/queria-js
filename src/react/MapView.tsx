import type { Map, MapOptions, StyleSpecification } from "maplibre-gl";
import { type ReactNode, useEffect, useRef } from "react";
import { type MapHandle, mountMap } from "../render/map.js";

type Props = {
  style: StyleSpecification | string;
  /** Called once when the map is created. Attach handlers here and return a cleanup. */
  onReady?: (map: Map) => void | (() => void);
  options?: Omit<MapOptions, "container" | "style">;
  className?: string;
  children?: ReactNode;
};

/** A MapLibre map. Passing a new style applies only the diff. */
export const MapView = ({ style, onReady, options, className = "viz-map", children }: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const h = mountMap(container.current, style, options);
    handle.current = h;
    const cleanup = h.map.then((m) => onReady?.(m));
    return () => {
      cleanup.then((f) => f?.(), console.error);
      h.destroy();
      handle.current = null;
    };
    // Create the map once; style changes are applied below.
  }, []);

  useEffect(() => {
    handle.current?.map.then((m) => m.setStyle(style), console.error);
  }, [style]);

  return (
    <div className={className} ref={container}>
      {children}
    </div>
  );
};
