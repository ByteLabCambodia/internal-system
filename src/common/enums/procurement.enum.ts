export enum PrStatusEnum {
  draft = 'draft',
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  cancelled = 'cancelled',
  converted = 'converted',
}

export enum PoTypeEnum {
  online = 'online',
  physical = 'physical',
}

export enum PoStatusEnum {
  open = 'open',
  partial = 'partial',
  complete = 'complete',
  cancelled = 'cancelled',
}

export enum PaymentStatusEnum {
  unpaid = 'unpaid',
  partial = 'partial',
  paid = 'paid',
}

export enum PaymentMethodEnum {
  bank_transfer = 'bank_transfer',
  cash = 'cash',
  card = 'card',
  mobile = 'mobile',
  other = 'other',
}
