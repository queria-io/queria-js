import type { ChartSpec, Rows } from "./chart.js";
import { type Channel, type Encoding, isView, keysOf, type View } from "./view.js";

/**
 * A short note on a chart, with an arrow to the point it is about.
 * `at` picks the row: one value, or several that must all match (such as a year and a series). Values are compared
 * as text with the fields of the encoding, and dates also match their day.
 * The note is placed `dx` and `dy` pixels from the point (20 and -30 by default: up and to the right).
 */
export type Annotation = { at: unknown; text: string; dx?: number; dy?: number };

const fieldOf = (c: Channel | undefined): string | undefined => (typeof c?.field === "string" ? c.field : undefined);

// The encoding that places the marks: the view's own, or that of the first layer with x and y, over the shared one.
// A view faceted by its encoding (row, column, facet) is several views, and cannot be layered.
const encodingOf = (v: View, shared: Encoding = {}): Encoding | undefined => {
  const own = { ...shared, ...v.encoding };
  if (own.row || own.column || own.facet) return undefined;
  if (fieldOf(own.x) && fieldOf(own.y)) return own;
  return v.layer?.map((l) => encodingOf(l, own)).find((e) => e !== undefined);
};

// The end of the arrow at the value: the field as the chart reads it, by its time unit and aggregate.
const end = (c: Channel): Channel => ({
  field: c.field,
  ...(c.timeUnit ? { timeUnit: c.timeUnit } : {}),
  ...(c.aggregate ? { aggregate: c.aggregate } : {}),
});

// What places the value on the shared scale. The sort and the title are kept so the order of the axis and its title
// stay the same.
const position = (c: Channel): Channel => ({
  ...end(c),
  ...(c.type ? { type: c.type } : {}),
  ...(c.sort !== undefined ? { sort: c.sort } : {}),
  ...("title" in c ? { title: c.title } : {}),
});

// The rows drawn as one mark with the row. When x or y is aggregated, the chart draws a mark for each group of rows
// with the same values in the fields without an aggregate, so the note reads the whole group.
const groupOf = (row: Record<string, unknown>, rows: Rows, enc: Encoding): Record<string, unknown>[] => {
  if (!enc.x?.aggregate && !enc.y?.aggregate) return [row];
  const keys = Object.values(enc)
    .filter((c) => c !== undefined && !c.aggregate)
    .map(fieldOf)
    .filter((f): f is string => f !== undefined);
  return rows.filter((r) => keys.every((k) => keysOf(r[k])[0] === keysOf(row[k])[0]));
};

const GAP = 5;

/** Colors of the notes: the text, and the arrow. */
export type Ink = { text: string; line: string };

// The arrow (a line and a triangle at the point) and the text, as layers that read only the annotated rows.
const layersOf = (rows: Rows, enc: Encoding, { text, dx = 20, dy = -30 }: Annotation, ink: Ink): View[] => {
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const [x, y] = [enc.x as Channel, enc.y as Channel];
  const encoding = { x: position(x), y: position(y) };
  // The color is set here, so the notes do not take the series color of the chart.
  const at = (color: string) => ({ data: { values: rows.map((r) => ({ ...r })) }, encoding: { ...encoding, color: { value: color } } });
  const line = at(ink.line);
  const stroke = { tooltip: false, opacity: 0.8 };
  return [
    {
      ...line,
      encoding: { ...line.encoding, x2: end(x), y2: end(y) },
      mark: { type: "rule", ...stroke, strokeWidth: 1, xOffset: ux * GAP, yOffset: uy * GAP, x2Offset: dx - ux * 4, y2Offset: dy - uy * 4 },
    },
    {
      ...line,
      // triangle-up turned so that its tip points from the text to the value
      mark: { type: "point", ...stroke, shape: "triangle-up", filled: true, size: 30, angle: (Math.atan2(-dx, dy) * 180) / Math.PI, xOffset: ux * (GAP + 2), yOffset: uy * (GAP + 2) },
    },
    {
      ...at(ink.text),
      mark: {
        type: "text",
        tooltip: false,
        text,
        fontSize: 12,
        dx,
        dy,
        align: dx > 0 ? "left" : dx < 0 ? "right" : "center",
        baseline: dy < 0 ? "bottom" : dy > 0 ? "top" : "middle",
      },
    },
  ];
};

// Keys of a single view that go into its layer when it becomes a layered view; the rest stay at the top.
const UNIT = ["mark", "encoding", "transform", "params", "projection"];

/**
 * Add notes with arrows to a single or layered view. Each note points at the first row whose encoded values match
 * its `at`, by the x and y of that row. Notes whose row is not found, and charts of several views (facet, concat),
 * are left as they are. Returns the spec and how many notes were added.
 */
export const withAnnotations = (spec: ChartSpec, rows: Rows, annotations: readonly Annotation[], ink: Ink): { spec: ChartSpec; added: number } => {
  const enc = annotations.length > 0 && isView(spec) ? encodingOf(spec) : undefined;
  if (enc === undefined) return { spec, added: 0 };
  const fields = Object.values(enc).map(fieldOf).filter((f): f is string => f !== undefined);
  const find = (a: Annotation) => {
    const texts = [a.at].flat().map(String);
    return rows.find((r) => texts.every((t) => fields.some((f) => keysOf(r[f]).includes(t))));
  };
  const notes = annotations.flatMap((a) => {
    const row = find(a);
    return row && row[fieldOf(enc.x) as string] != null && row[fieldOf(enc.y) as string] != null ? [layersOf(groupOf(row, rows, enc), enc, a, ink)] : [];
  });
  if (notes.length === 0) return { spec, added: 0 };
  const view = spec as View;
  if (view.layer) {
    // The shared encoding goes into the chart's own layers, so that the notes do not take its other channels (size,
    // shape, text and so on).
    const { encoding, ...rest } = view;
    const layer = encoding ? view.layer.map((l) => ({ ...l, encoding: { ...encoding, ...l.encoding } })) : view.layer;
    return { spec: { ...rest, layer: [...layer, ...notes.flat()] }, added: notes.length };
  }
  const unit = Object.fromEntries(UNIT.filter((k) => k in view).map((k) => [k, view[k]]));
  const top = Object.fromEntries(Object.entries(view).filter(([k]) => !UNIT.includes(k)));
  return { spec: { ...top, layer: [unit, ...notes.flat()] }, added: notes.length };
};
