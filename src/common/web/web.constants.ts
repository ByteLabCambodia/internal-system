/**
 * Top-level URL segments served as EJS pages rather than JSON API routes. They are excluded
 * from the global `api` prefix in main.ts — add a segment here when you add a page module,
 * or its routes will land under /api and 404 in the browser.
 */
export const WEB_ROUTE_PREFIXES = [
  '',
  'login',
  'logout',
  'forgot-password',
  'reset-password',
  'set-password',
  'dashboard',
  'purchase-requests',
  'purchase-orders',
  'claims',
  'stock-requests',
  'inventory',
  'reports',
  'accounting',
  'admin',
  'profile',
  'uploads',
  'telegram',
];

/**
 * The Mini App is split: the EJS shell is a page at `/miniapp`, but its JSON API keeps the
 * `api` prefix (`/api/v1/miniapp/*`), so only the exact shell path is excluded — not the
 * whole segment.
 */
export const MINIAPP_SHELL_PATH = 'miniapp';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const FLASH_COOKIE = 'flash';
export const CSRF_SECRET_COOKIE = 'csrf_secret';
