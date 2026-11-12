import type { ChartSpec, Rows } from "./chart.js";

/**
 * A short note on a chart, with an arrow to the point it is about.
 * `at` picks the row: one value, or several that must all match (such as a year and a series). Values are compared
 * as text with the fields of the encoding, and dates also match their day.
 * The note is placed `dx` and `dy` pixels from the point (20 and -30 by default: up and to the right).
 */
export type Annotation = { at: unknown; text: string; dx?: number; dy?: number };

type Channel = { field?: unknown; type?: unknown; timeUnit?: unknown; [k: string]: unknown };
type Encoding = Record<string, Channel | undefined>;
type View = { mark?: unknown; encoding?: Encoding; layer?: View[]; [k: string]: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const keysOf = (v: unknown): string[] => (v instanceof Date ? [v.toISOString(), v.toISOString().slice(0, 10)] : [String(v)]);

const fieldOf = (c: Channel | undefined): string | undefined => (typeof c?.field === "string" ? c.field : undefined);

// The encoding that places the marks: the view's own, or that of the first layer with x and y, over the shared one.
const encodingOf = (v: View, shared: Encoding = {}): Encoding | undefined => {
  const own = { ...shared, ...v.encoding };
  if (fieldOf(own.x) && fieldOf(own.y)) return own;
  return v.layer?.map((l) => encodingOf(l, own)).find((e) => e !== undefined);
};

// What places the value on the shared scale. The title and the aggregate are kept so the axis title stays the same;
// an aggregate that changes a single value, such as count, is dropped.
const KEEPS_VALUE = ["sum", "mean", "average", "median", "min", "max"];
const position = (c: Channel): Channel => ({
  field: c.field,
  ...(c.type ? { type: c.type } : {}),
  ...(c.timeUnit ? { timeUnit: c.timeUnit } : {}),
  ...(KEEPS_VALUE.includes(String(c.aggregate)) ? { aggregate: c.aggregate } : {}),
  ...("title" in c ? { title: c.title } : {}),
});

const GAP = 5;

/** Colors of the notes: the text, and the arrow. */
export type Ink = { text: string; line: string };

// The arrow (a line and a triangle at the point) and the text, as layers that read only the annotated row.
const layersOf = (row: Record<string, unknown>, enc: Encoding, { text, dx = 20, dy = -30 }: Annotation, ink: Ink): View[] => {
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const encoding = { x: position(enc.x as Channel), y: position(enc.y as Channel) };
  // The color is set here, so the notes do not take the series color of a shared encoding.
  const at = (color: string) => ({ data: { values: [{ ...row }] }, encoding: { ...encoding, color: { value: color } } });
  const stroke = { tooltip: false, opacity: 0.8 };
  return [
    {
      ...at(ink.line),
      encoding: { ...at(ink.line).encoding, x2: { field: fieldOf(enc.x) }, y2: { field: fieldOf(enc.y) } },
      mark: { type: "rule", ...stroke, strokeWidth: 1, xOffset: ux * GAP, yOffset: uy * GAP, x2Offset: dx - ux * 4, y2Offset: dy - uy * 4 },
    },
    {
      ...at(ink.line),
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
  const enc = isObject(spec) ? encodingOf(spec as View) : undefined;
  if (enc === undefined) return { spec, added: 0 };
  const fields = Object.values(enc).map(fieldOf).filter((f): f is string => f !== undefined);
  const find = (a: Annotation) => {
    const texts = [a.at].flat().map(String);
    return rows.find((r) => texts.every((t) => fields.some((f) => keysOf(r[f]).includes(t))));
  };
  const added = annotations.flatMap((a) => {
    const row = find(a);
    return row && row[fieldOf(enc.x) as string] != null && row[fieldOf(enc.y) as string] != null ? layersOf(row, enc, a, ink) : [];
  });
  if (added.length === 0) return { spec, added: 0 };
  const view = spec as View;
  if (view.layer) return { spec: { ...view, layer: [...view.layer, ...added] }, added: added.length / 3 };
  const unit = Object.fromEntries(UNIT.filter((k) => k in view).map((k) => [k, view[k]]));
  const top = Object.fromEntries(Object.entries(view).filter(([k]) => !UNIT.includes(k)));
  return { spec: { ...top, layer: [unit, ...added] }, added: added.length / 3 };
};
