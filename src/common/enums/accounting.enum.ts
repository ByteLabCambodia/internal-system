export enum AccountTypeEnum {
  asset = 'asset',
  liability = 'liability',
  equity = 'equity',
  income = 'income',
  expense = 'expense',
}

export enum JournalSourceEnum {
  po_payment = 'po_payment',
  manual_income = 'manual_income',
  manual = 'manual',
  sales_invoice = 'sales_invoice',
  sales_receipt = 'sales_receipt',
}

export enum RateSourceEnum {
  api = 'api',
  manual = 'manual',
}
