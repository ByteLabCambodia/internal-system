import { AccountEntity } from '../../../src/accounting/entities/account.entity';
import { BudgetEntity } from '../../../src/accounting/entities/budget.entity';
import { ExchangeRateEntity } from '../../../src/accounting/entities/exchange-rate.entity';
import { JournalEntryEntity } from '../../../src/accounting/entities/journal-entry.entity';
import { JournalLineEntity } from '../../../src/accounting/entities/journal-line.entity';
import { ActivityEventEntity } from '../../../src/activity/entities/activity-event.entity';
import { AuthTokenEntity } from '../../../src/auth/entities/auth-token.entity';
import { FileEntity } from '../../../src/files/infrastructure/persistence/relational/entities/file.entity';
import { CategoryEntity } from '../../../src/inventory/entities/category.entity';
import { InventoryClaimEntity } from '../../../src/inventory/entities/inventory-claim.entity';
import { InventoryItemEntity } from '../../../src/inventory/entities/inventory-item.entity';
import { StockMovementEntity } from '../../../src/inventory/entities/stock-movement.entity';
import { NotificationEntity } from '../../../src/notifications/entities/notification.entity';
import { ApprovalThresholdEntity } from '../../../src/org/entities/approval-threshold.entity';
import { DepartmentEntity } from '../../../src/org/entities/department.entity';
import { ProjectEntity } from '../../../src/org/entities/project.entity';
import { SupplierEntity } from '../../../src/org/entities/supplier.entity';
import { PaymentEntity } from '../../../src/procurement/entities/payment.entity';
import { PurchaseOrderItemEntity } from '../../../src/procurement/entities/purchase-order-item.entity';
import { PurchaseOrderEntity } from '../../../src/procurement/entities/purchase-order.entity';
import { PurchaseRequestItemEntity } from '../../../src/procurement/entities/purchase-request-item.entity';
import { PurchaseRequestEntity } from '../../../src/procurement/entities/purchase-request.entity';
import { RoleEntity } from '../../../src/roles/infrastructure/persistence/relational/entities/role.entity';
import { SessionEntity } from '../../../src/session/infrastructure/persistence/relational/entities/session.entity';
import { AppSettingEntity } from '../../../src/settings/entities/app-setting.entity';
import { StockRequestEntity } from '../../../src/stock/entities/stock-request.entity';
import { TelegramUpdateEntity } from '../../../src/telegram/entities/telegram-update.entity';
import { UserEntity } from '../../../src/users/infrastructure/persistence/relational/entities/user.entity';

import { CreateUser1715028537217 } from '../../../src/database/migrations/1715028537217-CreateUser';
import { OperationsUser1785888000000 } from '../../../src/database/migrations/1785888000000-OperationsUser';
import { OperationsSchema1785888100000 } from '../../../src/database/migrations/1785888100000-OperationsSchema';
import { OperationsTriggers1785888200000 } from '../../../src/database/migrations/1785888200000-OperationsTriggers';
import { AllowPrSelfApproval1785888300000 } from '../../../src/database/migrations/1785888300000-AllowPrSelfApproval';
import { ClarifyOverpaymentMessage1785888400000 } from '../../../src/database/migrations/1785888400000-ClarifyOverpaymentMessage';
import { OmitZeroAlreadyPaid1785888500000 } from '../../../src/database/migrations/1785888500000-OmitZeroAlreadyPaid';
import { RemoveManagerApprovalLimit1785888600000 } from '../../../src/database/migrations/1785888600000-RemoveManagerApprovalLimit';
import { MoveWorkflowTriggersToServices1785888700000 } from '../../../src/database/migrations/1785888700000-MoveWorkflowTriggersToServices';
import { MoveUsdAndTimestampsToApp1785888800000 } from '../../../src/database/migrations/1785888800000-MoveUsdAndTimestampsToApp';

/**
 * Listed explicitly rather than globbed: TypeORM's glob loader bypasses Jest's module
 * registry, so `.ts` entity files would not be transformed.
 */
export const ENTITIES = [
  AccountEntity,
  BudgetEntity,
  ExchangeRateEntity,
  JournalEntryEntity,
  JournalLineEntity,
  ActivityEventEntity,
  AuthTokenEntity,
  FileEntity,
  CategoryEntity,
  InventoryClaimEntity,
  InventoryItemEntity,
  StockMovementEntity,
  NotificationEntity,
  ApprovalThresholdEntity,
  DepartmentEntity,
  ProjectEntity,
  SupplierEntity,
  PaymentEntity,
  PurchaseOrderItemEntity,
  PurchaseOrderEntity,
  PurchaseRequestItemEntity,
  PurchaseRequestEntity,
  RoleEntity,
  SessionEntity,
  AppSettingEntity,
  StockRequestEntity,
  TelegramUpdateEntity,
  UserEntity,
];

export const MIGRATIONS = [
  CreateUser1715028537217,
  OperationsUser1785888000000,
  OperationsSchema1785888100000,
  OperationsTriggers1785888200000,
  AllowPrSelfApproval1785888300000,
  ClarifyOverpaymentMessage1785888400000,
  OmitZeroAlreadyPaid1785888500000,
  RemoveManagerApprovalLimit1785888600000,
  MoveWorkflowTriggersToServices1785888700000,
  MoveUsdAndTimestampsToApp1785888800000,
];
