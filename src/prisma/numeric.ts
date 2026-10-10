import type {
  Numeric,
  TimestampString,
  TimestamptzString,
} from '@prisma/orm-postgres/target/codec-types';

/**
 * Prisma 8 types `numeric(p, s)` columns as a branded string. The value is still the
 * plain decimal string the app works with everywhere (MoneyService, Decimal), so this
 * only labels it for a write. Pass strings already rounded to the column's scale.
 */
export const money = (value: string) => value as Numeric<18, 4>;
export const rate = (value: string) => value as Numeric<18, 6>;

export function nullableMoney(value: string | null): Numeric<18, 4> | null {
  return value === null ? null : money(value);
}

/** A zone-less `timestamp` value (see toTimestamp in dates.ts). */
export const timestamp = (value: string) => value as TimestampString;

/** A `timestamptz` value; an ISO string with its zone. */
export const timestamptz = (date: Date) =>
  date.toISOString() as TimestamptzString;
