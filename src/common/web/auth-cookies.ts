import { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './web.constants';

const BASE: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

export function setAuthCookies(
  response: Response,
  tokens: { token: string; refreshToken: string; tokenExpires?: number },
): void {
  response.cookie(ACCESS_TOKEN_COOKIE, tokens.token, BASE);
  response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, BASE);
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
  response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
}
