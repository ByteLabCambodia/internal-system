type SummarizableItem = { name: string; qty: string | number };

const MAX_ITEMS_SHOWN = 6;

/** A short "name ×qty" list for a Telegram notification, capped so a long PR doesn't
 *  blow past a readable message length. */
export function summarizeItems(items: SummarizableItem[]): string | undefined {
  if (!items.length) return undefined;

  const lines = items
    .slice(0, MAX_ITEMS_SHOWN)
    .map((item) => `${item.name} ×${Number(item.qty)}`);

  const remaining = items.length - MAX_ITEMS_SHOWN;
  if (remaining > 0) lines.push(`…+${remaining} more`);

  return lines.join('\n');
}
