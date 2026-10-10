import { databaseUrl, databaseUrlWithSsl } from './database-url';

describe('databaseUrl', () => {
  it('should prefer DATABASE_URL and otherwise build one from the parts', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgres://a@b/c' })).toBe(
      'postgres://a@b/c',
    );
    expect(
      databaseUrl({
        DATABASE_USERNAME: 'app',
        DATABASE_PASSWORD: 'p@ss:word',
        DATABASE_HOST: 'db',
        DATABASE_PORT: '5433',
        DATABASE_NAME: 'api',
      }),
    ).toBe('postgres://app:p%40ss%3Aword@db:5433/api');
  });
});

describe('databaseUrlWithSsl', () => {
  const url = 'postgres://app@db/api';

  it('should leave the URL alone without SSL', () => {
    expect(databaseUrlWithSsl({ DATABASE_URL: url })).toBe(url);
  });

  it('should skip certificate checks unless told to reject unauthorized', () => {
    expect(
      databaseUrlWithSsl({ DATABASE_URL: url, DATABASE_SSL_ENABLED: 'true' }),
    ).toBe(`${url}?sslmode=no-verify`);
    expect(
      databaseUrlWithSsl({
        DATABASE_URL: `${url}?application_name=x`,
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_REJECT_UNAUTHORIZED: 'true',
      }),
    ).toBe(`${url}?application_name=x&sslmode=verify-full`);
  });

  it('should keep an sslmode the URL already has', () => {
    expect(
      databaseUrlWithSsl({
        DATABASE_URL: `${url}?sslmode=disable`,
        DATABASE_SSL_ENABLED: 'true',
      }),
    ).toBe(`${url}?sslmode=disable`);
  });
});
