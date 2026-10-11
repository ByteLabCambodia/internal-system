import { Client } from 'pg';

/**
 * Everything in the `public` schema that behaviour depends on, as sorted text: columns
 * (type, nullability, default), constraints, indexes, triggers, functions, sequences and
 * enum values. TypeORM's own `migrations` table is left out. Defaults are normalised
 * where Postgres spells the same value two ways ('0'::numeric(18,4) vs 0).
 */
export async function schemaFingerprint(url: string): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const sections = await Promise.all([
      client.query(`
        SELECT 'column ' || table_name || '.' || column_name || ' ' || udt_name ||
               ' ' || is_nullable || ' ' || COALESCE(column_default, '') AS line
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name <> 'migrations'`),
      client.query(`
        SELECT 'constraint ' || rel.relname || '.' || con.conname || ' ' ||
               pg_get_constraintdef(con.oid) AS line
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'public' AND rel.relname <> 'migrations'`),
      client.query(`
        SELECT 'index ' || indexdef AS line FROM pg_indexes
         WHERE schemaname = 'public' AND tablename <> 'migrations'`),
      client.query(`
        SELECT 'trigger ' || pg_get_triggerdef(t.oid) AS line
          FROM pg_trigger t
          JOIN pg_class rel ON rel.oid = t.tgrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'public' AND NOT t.tgisinternal`),
      client.query(`
        SELECT 'function ' || p.proname || ' ' ||
               regexp_replace(p.prosrc, '\\s+', ' ', 'g') AS line
          FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.prokind = 'f'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.objid = p.oid AND d.deptype = 'e')`),
      client.query(`
        SELECT 'sequence ' || sequencename AS line FROM pg_sequences
         WHERE schemaname = 'public' AND sequencename <> 'migrations_id_seq'`),
      client.query(`
        SELECT 'enum ' || t.typname || ' ' ||
               string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS line
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          JOIN pg_namespace ns ON ns.oid = t.typnamespace
         WHERE ns.nspname = 'public'
         GROUP BY t.typname`),
    ]);

    return sections
      .flatMap((section) => section.rows.map((row) => row.line as string))
      .map((line) =>
        line
          .replace(/'(\d+)'::numeric(\(\d+,\d+\))?/g, '$1')
          .replace(/(public\.)?uuid_generate_v4\(\)/, 'gen_random_uuid()'),
      )
      .sort();
  } finally {
    await client.end();
  }
}
