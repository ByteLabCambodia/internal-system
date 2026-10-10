import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TEST_DATABASE_URL, TestDb } from './test-db';
import { AccountsService } from '../../../src/accounting/accounts.service';
import { JournalService } from '../../../src/accounting/journal.service';
import { RatesService } from '../../../src/accounting/rates.service';
import { ReportsService } from '../../../src/accounting/reports.service';
import { DashboardService } from '../../../src/dashboard/dashboard.service';
import { ActivityService } from '../../../src/activity/activity.service';
import { MoneyService } from '../../../src/common/money/money.service';
import { CategoriesService } from '../../../src/inventory/categories.service';
import { ClaimsService } from '../../../src/inventory/claims.service';
import { InventoryService } from '../../../src/inventory/inventory.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { ApprovalThresholdsService } from '../../../src/org/approval-thresholds.service';
import { OrgService } from '../../../src/org/org.service';
import { SuppliersService } from '../../../src/org/suppliers.service';
import { PermissionsService } from '../../../src/permissions/permissions.service';
import { PaymentsService } from '../../../src/procurement/payments.service';
import { PurchaseOrdersService } from '../../../src/procurement/purchase-orders.service';
import { PurchaseRequestsService } from '../../../src/procurement/purchase-requests.service';
import { SettingsService } from '../../../src/settings/settings.service';
import { StockRequestsService } from '../../../src/stock/stock-requests.service';
import { TelegramService } from '../../../src/telegram/telegram.service';
import { TelegramLinkService } from '../../../src/telegram/telegram-link.service';
import { TelegramController } from '../../../src/telegram/telegram.controller';
import { FileRelationalRepository } from '../../../src/files/infrastructure/persistence/relational/repositories/file.repository';
import { FileRepository } from '../../../src/files/infrastructure/persistence/file.repository';
import { FilesService } from '../../../src/files/files.service';
import { UsersService } from '../../../src/users/users.service';
import { UserRepository } from '../../../src/users/infrastructure/persistence/user.repository';
import { UsersRelationalRepository } from '../../../src/users/infrastructure/persistence/relational/repositories/user.repository';
import { SessionService } from '../../../src/session/session.service';
import { SessionRepository } from '../../../src/session/infrastructure/persistence/session.repository';
import { SessionRelationalRepository } from '../../../src/session/infrastructure/persistence/relational/repositories/session.repository';
import { AuthTokensService } from '../../../src/auth/auth-tokens.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

export { TEST_DATABASE_URL };

/** Telegram is a courier, not part of the workflow under test. */
export const telegramStub = {
  isConfigured: false,
  miniAppUrl: null,
  webhookSecret: undefined as string | undefined,
  send: jest.fn().mockResolvedValue(null),
};

/**
 * The services, wired against a real Postgres. Built
 * from explicit providers instead of the feature modules so controllers, guards and
 * outbound integrations stay out of the picture.
 */
export async function createTestApp(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TelegramController],
    providers: [
      TestDb,
      FileRelationalRepository,
      { provide: FileRepository, useExisting: FileRelationalRepository },
      FilesService,
      UsersService,
      { provide: UserRepository, useClass: UsersRelationalRepository },
      SessionService,
      { provide: SessionRepository, useClass: SessionRelationalRepository },
      AuthTokensService,
      TelegramLinkService,
      AccountsService,
      ActivityService,
      ApprovalThresholdsService,
      CategoriesService,
      ClaimsService,
      DashboardService,
      InventoryService,
      JournalService,
      MoneyService,
      NotificationsService,
      OrgService,
      PaymentsService,
      PermissionsService,
      PurchaseOrdersService,
      PurchaseRequestsService,
      RatesService,
      ReportsService,
      SettingsService,
      StockRequestsService,
      SuppliersService,
      { provide: TelegramService, useValue: telegramStub },
      PrismaService,
      {
        provide: ConfigService,
        useValue: {
          get: () => undefined,
          getOrThrow: (key: string) => {
            if (key !== 'database')
              throw new Error(`No test config for ${key}`);
            return { url: TEST_DATABASE_URL, maxConnections: 10 };
          },
        },
      },
    ],
  }).compile();

  await moduleRef.init();
  return moduleRef;
}

/**
 * Every table the fixtures and workflows touch. `role` is seeded once per spec file and
 * kept, the rest is wiped between tests.
 */
const TRUNCATE = [
  'session',
  'auth_tokens',
  'stock_movements',
  'stock_requests',
  'inventory_claims',
  'journal_lines',
  'journal_entries',
  'budgets',
  'payments',
  'purchase_order_items',
  'purchase_orders',
  'purchase_request_items',
  'purchase_requests',
  'inventory_items',
  'categories',
  'notifications',
  'activity_events',
  'exchange_rates',
  'accounts',
  'app_settings',
  'suppliers',
  'departments',
  'projects',
  'approval_thresholds',
  'telegram_updates',
  'user',
  'file',
];

export async function resetData(dataSource: TestDb): Promise<void> {
  await dataSource.query(
    `TRUNCATE ${TRUNCATE.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await dataSource.query(`ALTER SEQUENCE "pr_number_seq" RESTART WITH 1`);
  await dataSource.query(`ALTER SEQUENCE "po_number_seq" RESTART WITH 1`);
}
