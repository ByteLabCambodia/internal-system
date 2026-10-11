/**
 * Helpers for whole-query SQL through Prisma's raw lane (`db.raw.sql`), used by the
 * reports and dashboard, whose GROUP BY / UNION shapes the ORM does not express.
 */

const TEXT = 'pg/text@1' as const;

/** A row spec whose columns are all text: the report queries cast every value `::text`. */
export function textRow<K extends string>(
  ...keys: K[]
): Record<K, typeof TEXT> {
  return Object.fromEntries(keys.map((key) => [key, TEXT])) as Record<
    K,
    typeof TEXT
  >;
}

/**
 * Open date bounds. The raw lane will not bind a bare null, and Postgres dates accept
 * `-infinity` / `infinity`, so an unset bound compares true without dynamic SQL.
 */
export const dateFrom = (date?: string) => date || '-infinity';
export const dateTo = (date?: string) => date || 'infinity';
