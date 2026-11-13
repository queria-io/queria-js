import { type MapLayer, type MapRenderOptions, renderMap } from "../render/data-map.js";
import { type Data, Frame, useDraw, useResult } from "./result.js";

type Props = { layer: MapLayer; className?: string } & MapRenderOptions & Data;

/** The SQL result (or `rows`) on a map by area code or by lng/lat, followed by the sources. Its height is the CSS variable --queria-map-height (400px by default). */
export const DataMap = ({ layer, className = "queria-map", style, theme, cooperativeGestures, ...data }: Props) => {
  const result = useResult(data);
  const [ref, error] = useDraw(result.values, (el, rows) => renderMap(el, layer, rows, { style, theme, cooperativeGestures }), [JSON.stringify([layer, style, theme, cooperativeGestures])]);
  return (
    <Frame className={className} result={result} error={error}>
      <div ref={ref} style={{ height: "var(--queria-map-height, 400px)" }} />
    </Frame>
  );
};
