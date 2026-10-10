/**
 * Prisma ORM 8 returns timestamp columns as Postgres text, e.g.
 * `2026-10-10 10:37:30.714423+07` (timestamptz) or `2026-10-10 10:37:30.714423`
 * (timestamp). The views and DTOs work with Date, so convert at the edge. A timestamp
 * without a zone is read as local time, which is what TypeORM/pg did before.
 */
export function toDate(value: string): Date;
export function toDate(value: string | null | undefined): Date | null;
export function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;

  const iso = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Unparseable timestamp from the database: ${value}`);
  }
  return date;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A Date as local wall-clock text for a zone-less `timestamp` column (the boilerplate's
 * user and session tables), e.g. `2026-10-10 12:45:05.817`. toDate() reads it back as
 * local time, which is how pg/TypeORM handled these columns.
 */
export function toTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    pad(date.getMilliseconds(), 3)
  );
}
