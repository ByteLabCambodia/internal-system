import {
  PoStatusEnum,
  PrStatusEnum,
  PaymentStatusEnum,
} from '../../common/enums';

export const FLOW_STEPS = [
  { label: 'Requested' },
  { label: 'Approved' },
  { label: 'Ordered' },
  { label: 'Paid' },
  { label: 'Received' },
];

/**
 * The unified flow stepper (Part 1 §2.1): Requested → Approved → Ordered → Paid → Received,
 * derived from PR and PO status rather than stored anywhere.
 */
export function flowIndex(input: {
  prStatus?: PrStatusEnum | null;
  poStatus?: PoStatusEnum | null;
  paymentStatus?: PaymentStatusEnum | null;
}): number {
  const { prStatus, poStatus, paymentStatus } = input;

  if (poStatus === PoStatusEnum.complete) return 4;
  if (paymentStatus === PaymentStatusEnum.paid) return 3;
  if (poStatus) return 2;
  if (
    prStatus === PrStatusEnum.approved ||
    prStatus === PrStatusEnum.converted
  ) {
    return 1;
  }

  return 0;
}
