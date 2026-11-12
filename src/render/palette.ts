/** Colors shared by charts and maps. Queria purple marks what matters; categories use the other colors. */
export const BASE = "#7846be";
/** Colors of categories and series, without the purple so that it stays free for highlights. */
export const SERIES = ["#3ba3a0", "#e0789b", "#e2a33b", "#5b8def", "#9c6b4e", "#8fa34a", "#d97757"];
/** The ends of the ramp for numbers. The light end stays visible on a light basemap at 0.6 opacity. */
export const RAMP: readonly [readonly number[], readonly number[]] = [
  [217, 204, 240],
  [84, 46, 140],
];
