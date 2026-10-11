export enum SalesDocTypeEnum {
  quotation = 'quotation',
  invoice = 'invoice',
  receipt = 'receipt',
}

export enum SalesDocStatusEnum {
  draft = 'draft',
  sent = 'sent',
  accepted = 'accepted',
  rejected = 'rejected',
  issued = 'issued',
  paid = 'paid',
  void = 'void',
}

export enum SalesDocLanguageEnum {
  both = 'both',
  km = 'km',
  en = 'en',
}

export enum DiscountTypeEnum {
  percent = 'percent',
  amount = 'amount',
}
