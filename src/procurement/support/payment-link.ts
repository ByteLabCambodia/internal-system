import { CurrencyEnum } from '../../common/enums';

/**
 * Builds the ABA PayWay link Finance actually opens to pay a requester: the
 * PO's amount is set on `amount`, and `acc` (the account the link pre-selects)
 * is swapped to whichever of `khrAcc`/`usdAcc` matches the PO's currency —
 * links commonly carry both, with `acc` picking one by default.
 *
 * Note: on the web fallback of this link type, ABA ignores `amount`/`acc` and
 * has the payer fill them in on their own page — this pre-fills the link for
 * whatever handles it (e.g. the ABA Mobile app via its deep-link handoff)
 * that does honor them, and is otherwise harmless since it degrades to the
 * unmodified link.
 */
export function buildPaymentLink(
  link: string,
  amount: number,
  currency: CurrencyEnum,
): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }

  url.searchParams.set('amount', amount.toFixed(2));

  const accParam =
    currency === CurrencyEnum.USD
      ? 'usdAcc'
      : currency === CurrencyEnum.KHR
        ? 'khrAcc'
        : null;
  const acc = accParam ? url.searchParams.get(accParam) : null;
  if (acc) url.searchParams.set('acc', acc);

  return url.toString();
}
