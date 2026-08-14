import { Response } from 'express';

/** RFC 4180 quoting: double the quotes, wrap anything containing a delimiter. */
function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\r\n');
}

/** Shared by every list page's export button. */
export function csvResponse(
  response: Response,
  fileName: string,
  headers: string[],
  rows: unknown[][],
): void {
  response
    .status(200)
    .setHeader('Content-Type', 'text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    // Excel needs the BOM to read UTF-8 correctly.
    .send('﻿' + toCsv(headers, rows));
}
