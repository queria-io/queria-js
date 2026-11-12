/** Quote a string as an SQL literal. */
export const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Blank out string literals, quoted identifiers and comments, scanning left to right. */
const stripLiterals = (sql: string): string =>
  sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith("'") ? "''" : " "));

/**
 * Dataset names referenced in SQL. Tables are written as <dataset>.<schema>.<table>,
 * so the first part of every three-part name outside string literals and comments is a dataset.
 * A struct field read as alias.column.field also matches; the client skips names that are not datasets.
 */
export const datasetsIn = (sql: string): string[] => [
  ...new Set(
    [...stripLiterals(sql).matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*/gi)].map(
      (m) => m[1].toLowerCase(),
    ),
  ),
];
