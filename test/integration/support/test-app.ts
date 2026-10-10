import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ENTITIES, MIGRATIONS } from './entities';
import { AccountsService } from '../../../src/accounting/accounts.service';
import { JournalService } from '../../../src/accounting/journal.service';
import { RatesService } from '../../../src/accounting/rates.service';
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
import { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * A dedicated, disposable database. Never point this at a database you care about: every
 * spec file drops the schema and re-runs all migrations.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://${process.env.USER}@localhost:5432/internal_system_test`;

// Each spec rebuilds the schema from migrations, so there is no signed marker to check.
// prisma-contract.int-spec.ts checks the contract against the schema instead.
process.env.PRISMA_VERIFY_MARKER = 'false';

/** Telegram is a courier, not part of the workflow under test. */
export const telegramStub = {
  isConfigured: false,
  miniAppUrl: null,
  send: jest.fn().mockResolvedValue(null),
};

/**
 * The services behind the trigger-backed workflows, wired against a real Postgres. Built
 * from explicit providers instead of the feature modules so controllers, guards and
 * outbound integrations stay out of the picture.
 */
export async function createTestApp(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: TEST_DATABASE_URL,
        entities: ENTITIES,
        migrations: MIGRATIONS,
        dropSchema: true,
        migrationsRun: true,
        logging: false,
        extra: { max: 10 },
      }),
      TypeOrmModule.forFeature(ENTITIES),
    ],
    providers: [
      AccountsService,
      ActivityService,
      ApprovalThresholdsService,
      CategoriesService,
      ClaimsService,
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
  'stock_movements',
  'stock_requests',
  'inventory_claims',
  'journal_lines',
  'journal_entries',
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
  'user',
];

export async function resetData(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `TRUNCATE ${TRUNCATE.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await dataSource.query(`ALTER SEQUENCE "pr_number_seq" RESTART WITH 1`);
  await dataSource.query(`ALTER SEQUENCE "po_number_seq" RESTART WITH 1`);
}
