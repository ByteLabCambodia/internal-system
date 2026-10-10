import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  q,
  seedRoles,
  seedStockRequest,
  seedWorld,
  World,
} from './support/fixtures';
import { PurchaseRequestsService } from '../../src/procurement/purchase-requests.service';
import { PurchaseOrdersService } from '../../src/procurement/purchase-orders.service';
import { StockRequestsService } from '../../src/stock/stock-requests.service';
import { CurrencyEnum, PoTypeEnum } from '../../src/common/enums';

/**
 * Derived USD totals (formerly trigger T1) and `updated_at` (formerly set_updated_at),
 * plus the database checks that still back them.
 */
describe('USD totals and timestamps', () => {
  let app: TestingModule;
  let db: DataSource;
  let world: World;
  let prs: PurchaseRequestsService;
  let pos: PurchaseOrdersService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    prs = app.get(PurchaseRequestsService);
    pos = app.get(PurchaseOrdersService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
  });

  const khrRequest = (submit: boolean) =>
    prs.create(
      world.employee,
      {
        currency: CurrencyEnum.KHR,
        items: [
          { name: 'Chairs', qty: 4, unitPrice: 50000 },
          { name: 'Desk', qty: 1, unitPrice: 200001 },
        ],
      },
      submit,
    );

  const prRow = (id: number) =>
    q(db, `SELECT * FROM purchase_requests WHERE id = $1`, [id]);

  it('should derive a request total in USD at the locked rate, rounded to 4 dp', async () => {
    const pr = await khrRequest(true);

    const row = await prRow(pr.id);
    expect(row.total_original).toBe('400001.0000');
    expect(row.exchange_rate).toBe('4000.000000');
    expect(row.total_usd).toBe('100.0003'); // 400001 / 4000 = 100.00025, half-up
  });

  it('should re-derive the USD total when submitting re-locks the rate', async () => {
    const pr = await khrRequest(false);
    await db.query(
      `UPDATE exchange_rates SET rate_to_usd = 5000 WHERE currency = 'KHR'`,
    );

    await prs.submit(world.employee, pr.id);

    const row = await prRow(pr.id);
    expect(row.exchange_rate).toBe('5000.000000');
    expect(row.total_usd).toBe('80.0002');
  });

  it('should give an order its own USD total at the request’s rate', async () => {
    const pr = await khrRequest(true);
    await db.query(
      `UPDATE purchase_requests SET status = 'approved' WHERE id = $1`,
      [pr.id],
    );

    const po = await pos.createFromRequest(world.manager, {
      prId: pr.id,
      type: PoTypeEnum.online,
      supplierName: 'Acme',
      items: [{ name: 'Chairs', qtyOrdered: 4, unitPrice: 48000 }],
    });

    const row = await q(db, `SELECT * FROM purchase_orders WHERE id = $1`, [
      po.id,
    ]);
    expect(row.total_original).toBe('192000.0000');
    expect(row.exchange_rate).toBe('4000.000000');
    expect(row.total_usd).toBe('48.0000');
  });

  it('should stamp updated_at when a row changes', async () => {
    const id = await seedStockRequest(
      db,
      world.employee,
      world.itemA,
      '1',
      'pending',
    );
    await db.query(
      `UPDATE stock_requests SET created_at = now() - interval '1 day',
                                 updated_at = now() - interval '1 day' WHERE id = $1`,
      [id],
    );

    await app.get(StockRequestsService).approve(world.manager, id);

    const row = await q(
      db,
      `SELECT updated_at > now() - interval '1 minute' AS fresh FROM stock_requests WHERE id = $1`,
      [id],
    );
    expect(row.fresh).toBe(true);
  });

  it.each([
    [
      'payments',
      `INSERT INTO payments (amount_original, exchange_rate) VALUES (10, 0)`,
    ],
    [
      'purchase_requests',
      `INSERT INTO purchase_requests (requester_id, exchange_rate) VALUES (1, -1)`,
    ],
    [
      'purchase_orders',
      `INSERT INTO purchase_orders (exchange_rate) VALUES (0)`,
    ],
  ])(
    'should still have the database refuse a non-positive exchange rate on %s',
    async (_, sql) => {
      await expect(db.query(sql)).rejects.toThrow(/exchange_rate/);
    },
  );
});
