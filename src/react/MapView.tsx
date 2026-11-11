import type { Map, MapOptions, StyleSpecification } from "maplibre-gl";
import { type ReactNode, useEffect, useRef } from "react";

type Props = {
  style: StyleSpecification | string;
  /** Called once when the map is created. Attach handlers here and return a cleanup. */
  onReady?: (map: Map) => void | (() => void);
  options?: Omit<MapOptions, "container" | "style">;
  className?: string;
  children?: ReactNode;
};

/** A MapLibre map. Passing a new style applies only the diff. Import maplibre-gl's CSS in your app. */
export const MapView = ({ style, onReady, options, className = "viz-map", children }: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);

  useEffect(() => {
    let cleanup: void | (() => void);
    let alive = true;
    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!alive || !container.current) return;
      const m = new maplibregl.Map({ container: container.current, style, ...options });
      map.current = m;
      cleanup = onReady?.(m);
    }, console.error);
    return () => {
      alive = false;
      cleanup?.();
      map.current?.remove();
      map.current = null;
    };
    // Create the map once; style changes are applied below.
  }, []);

  useEffect(() => {
    map.current?.setStyle(style);
  }, [style]);

  return (
    <div className={className} ref={container}>
      {children}
    </div>
  );
};
