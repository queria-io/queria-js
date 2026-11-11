/** Quote a string as an SQL literal. */
export const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

const stripLiterals = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''");

/**
 * Dataset names referenced in SQL. Tables are written as <dataset>.<schema>.<table>,
 * so the first part of every three-part name outside string literals is a dataset.
 */
export const datasetsIn = (sql: string): string[] => [
  ...new Set(
    [...stripLiterals(sql).matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*/gi)].map(
      (m) => m[1].toLowerCase(),
    ),
  ),
];
