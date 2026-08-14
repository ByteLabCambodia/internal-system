/** The permission matrix from Part 1 §1 of the brief, plus `suppliers.manage` from C4. */
export enum PermissionEnum {
  'pr.create' = 'pr.create',
  'pr.decide' = 'pr.decide',
  'pr.cancel' = 'pr.cancel',
  'po.create' = 'po.create',
  'po.cancel' = 'po.cancel',
  'payment.record' = 'payment.record',
  'claim.submit' = 'claim.submit',
  'claim.confirm' = 'claim.confirm',
  'stock.request' = 'stock.request',
  'stock.fulfil' = 'stock.fulfil',
  'inventory.manage' = 'inventory.manage',
  'accounting.view' = 'accounting.view',
  'income.add' = 'income.add',
  'rate.override' = 'rate.override',
  'users.manage' = 'users.manage',
  'suppliers.manage' = 'suppliers.manage',
}
