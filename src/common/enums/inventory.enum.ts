export enum ClaimStatusEnum {
  pending = 'pending',
  confirmed = 'confirmed',
  rejected = 'rejected',
}

export enum StockRequestStatusEnum {
  pending = 'pending',
  approved = 'approved',
  fulfilled = 'fulfilled',
  rejected = 'rejected',
}

export enum StockPriorityEnum {
  low = 'low',
  medium = 'medium',
  high = 'high',
  urgent = 'urgent',
}

export enum MovementReasonEnum {
  claim = 'claim',
  stock_request = 'stock_request',
  adjustment = 'adjustment',
}
