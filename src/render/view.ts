/** A channel of a Vega-Lite encoding, such as x or color. */
export type Channel = { field?: unknown; [k: string]: unknown };
export type Encoding = Record<string, Channel | undefined>;
/** A single or layered Vega-Lite view. */
export type View = { mark?: unknown; encoding?: Encoding; layer?: View[]; [k: string]: unknown };

export const isView = (v: unknown): v is View => typeof v === "object" && v !== null && !Array.isArray(v);

// Text keys of a value. Dates also match their day, as in "2020-04-01".
export const keysOf = (v: unknown): string[] => (v instanceof Date ? [v.toISOString(), v.toISOString().slice(0, 10)] : [String(v)]);
