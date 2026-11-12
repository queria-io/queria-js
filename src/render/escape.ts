const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for use in HTML or SVG markup. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => entities[c] ?? c);
