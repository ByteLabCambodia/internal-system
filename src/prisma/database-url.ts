/**
 * The app configures Postgres either with DATABASE_URL or with the separate
 * DATABASE_HOST/PORT/USERNAME/PASSWORD/NAME variables (see database.config.ts). Prisma
 * takes one URL, so build it from the parts when no URL is set.
 */
export function databaseUrl(env: Record<string, string | undefined>): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const user = encodeURIComponent(env.DATABASE_USERNAME ?? '');
  const password = env.DATABASE_PASSWORD
    ? `:${encodeURIComponent(env.DATABASE_PASSWORD)}`
    : '';
  const host = env.DATABASE_HOST ?? 'localhost';
  const port = env.DATABASE_PORT ?? '5432';

  return `postgres://${user}${password}@${host}:${port}/${env.DATABASE_NAME ?? ''}`;
}

/**
 * databaseUrl() plus the SSL settings the app passes to `pg` separately
 * (DATABASE_SSL_ENABLED, DATABASE_REJECT_UNAUTHORIZED), for tools that take only a URL:
 * the migrator and the Prisma CLI. An sslmode already in the URL wins.
 */
export function databaseUrlWithSsl(
  env: Record<string, string | undefined>,
): string {
  const url = databaseUrl(env);
  if (env.DATABASE_SSL_ENABLED !== 'true' || /[?&]sslmode=/.test(url)) {
    return url;
  }

  const mode =
    env.DATABASE_REJECT_UNAUTHORIZED === 'true' ? 'verify-full' : 'no-verify';
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=${mode}`;
}
