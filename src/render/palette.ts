/** Colors shared by charts and maps. Queria purple marks what matters; categories use the other colors. */
export const BASE = "#7846be";
/** Colors of categories and series, without the purple so that it stays free for highlights. */
export const SERIES = ["#3ba3a0", "#e0789b", "#e2a33b", "#5b8def", "#9c6b4e", "#8fa34a", "#d97757"];
/** The color of the categories beyond SERIES, gathered as one. */
export const OTHER = "#9ca3af";
/**
 * The ramp for numbers, yellow to green to blue, so that neighboring steps tell apart, also for color vision
 * deficiencies. The purple stays free for highlights. The light end stays visible on a light basemap at 0.6 opacity.
 */
export const RAMP = ["#edf8b1", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"] as const;
/** The ramp for lines, such as flows: few in gray, many in blue. Thin gray lines stay visible on the basemap. */
export const LINE_RAMP = ["#c4c4cc", "#a1a1aa", "#41b6c4", "#2c7fb8", "#253494"] as const;
/** Colors of map layers without a color column, in order, so that layers drawn together tell apart. */
export const LAYER_COLORS = [BASE, "#db2777", "#0891b2", "#65a30d"] as const;
/** Named ramps for maps, light to dark. A layer without a color column takes the dark end. */
export const PALETTES = {
  blues: ["#93c5fd", "#1e3a8a"],
  reds: ["#fca5a5", "#991b1b"],
  greens: ["#86efac", "#166534"],
  oranges: ["#fdba74", "#9a3412"],
  purples: ["#d8b4fe", "#6b21a8"],
  grays: ["#cbd5e1", "#1e293b"],
} as const satisfies Record<string, readonly [string, string]>;
export type Palette = keyof typeof PALETTES;
