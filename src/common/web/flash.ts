import { Request, Response } from 'express';
import { FLASH_COOKIE } from './web.constants';

export type FlashKind = 'success' | 'error' | 'info';
export type FlashMessage = { kind: FlashKind; message: string };

/**
 * Cookie-backed flash. POST-redirect-GET needs a message to survive exactly one redirect,
 * and cookies do that without dragging in a session store this app otherwise has no use for.
 */
export function setFlash(
  response: Response,
  kind: FlashKind,
  message: string,
): void {
  const existing: FlashMessage[] = response.locals.pendingFlash ?? [];
  existing.push({ kind, message });
  response.locals.pendingFlash = existing;

  response.cookie(FLASH_COOKIE, JSON.stringify(existing), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

export function takeFlash(
  request: Request,
  response: Response,
): FlashMessage[] {
  const raw = request.cookies?.[FLASH_COOKIE];
  if (!raw) return [];

  response.clearCookie(FLASH_COOKIE, { path: '/' });

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
