/**
 * Where the browser tests run. A dedicated database that global-setup drops and
 * recreates on every run, so never point E2E_DATABASE_URL at data you care about.
 */
export const BROWSER_PORT = Number(process.env.E2E_PORT ?? 3998);

export const BROWSER_DB =
  process.env.E2E_DATABASE_URL ??
  `postgres://${process.env.USER}@localhost:5432/internal_system_browser_test`;

/** Env for the app server and the migration/seed scripts. Overrides .env. */
export function serverEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  return {
    NODE_ENV: 'test',
    APP_PORT: String(BROWSER_PORT),
    PORT: String(BROWSER_PORT),
    DATABASE_TYPE: 'postgres',
    DATABASE_URL: databaseUrl,
    DATABASE_HOST: url.hostname,
    DATABASE_PORT: url.port || '5432',
    DATABASE_USERNAME: decodeURIComponent(url.username),
    DATABASE_PASSWORD: decodeURIComponent(url.password),
    DATABASE_NAME: url.pathname.slice(1),
    DATABASE_SSL_ENABLED: 'false',
    // Nothing leaves the machine: no Telegram, mail or OCR calls from tests.
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    TELEGRAM_MINIAPP_URL: '',
    MAIL_HOST: '',
    OCR_SPACE_API_KEY: '',
    FILE_DRIVER: 'local',
    // The seed would otherwise also create the ADMIN_EMAIL account from .env.
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
  };
}
