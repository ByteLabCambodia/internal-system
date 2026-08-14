import { ValueTransformer } from 'typeorm';

/**
 * Money and quantity columns are `numeric` in Postgres. `pg` already returns them as
 * strings to avoid float rounding; this transformer makes that explicit and keeps the
 * TypeScript side a string in both directions. NEVER map these columns to `number`.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: string | number | null): string | null | undefined => {
    if (value === null || value === undefined) return value;
    return String(value);
  },
  from: (value?: string | null): string | null | undefined => {
    if (value === null || value === undefined) return value;
    return String(value);
  },
};
