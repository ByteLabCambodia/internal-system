import { TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  q,
  seedRoles,
  seedStockRequest,
  seedWorld,
  World,
} from './support/fixtures';
import { StockRequestsService } from '../../src/stock/stock-requests.service';

/**
 * Fulfilling a stock request (formerly trigger T4): insufficient-stock guard, stock out,
 * the movement ledger, and the auto-reorder draft PR plus manager notifications.
 */
describe('StockRequestsService.fulfil', () => {
  let app: TestingModule;
  let db: DataSource;
  let requests: StockRequestsService;
  let world: World;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    requests = app.get(StockRequestsService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
  });

  const stockOf = async (itemId: number) =>
    (
      await q(db, `SELECT stock_qty FROM inventory_items WHERE id = $1`, [
        itemId,
      ])
    ).stock_qty;

  /** SKU-R: 10 on hand, reorder at 5, reorder 20. */
  const reorderItem = async (reorderQty = '20') =>
    (
      await q(
        db,
        `INSERT INTO inventory_items (sku, name, category, stock_qty, reorder_point, reorder_qty)
         VALUES ('SKU-R', 'Printer paper', 'Supplies', 10, 5, $1) RETURNING id`,
        [reorderQty],
      )
    ).id as number;

  it('should move stock out and writes the ledger row', async () => {
    const id = await seedStockRequest(db, world.employee, world.itemA, '3');

    await requests.fulfil(world.manager, id);

    expect(await stockOf(world.itemA)).toBe('7.0000');

    const row = await q(db, `SELECT * FROM stock_requests WHERE id = $1`, [id]);
    expect(row.status).toBe('fulfilled');
    expect(row.fulfilled_by).toBe(world.manager.id);
    expect(row.fulfilled_at).not.toBeNull();

    expect(await db.query(`SELECT * FROM stock_movements`)).toEqual([
      expect.objectContaining({
        inventory_item_id: world.itemA,
        delta: '-3.0000',
        reason: 'stock_request',
        ref_table: 'stock_requests',
        ref_id: id,
        balance_after: '7.0000',
        created_by: world.manager.id,
      }),
    ]);

    expect(await db.query(`SELECT 1 FROM purchase_requests`)).toHaveLength(0);
  });

  it('should refuse to take stock below zero', async () => {
    const id = await seedStockRequest(db, world.employee, world.itemA, '11');

    await expect(requests.fulfil(world.manager, id)).rejects.toThrow(
      new UnprocessableEntityException(
        'insufficient stock for SKU-A: 10.0000 on hand, 11.0000 requested',
      ),
    );

    expect(await stockOf(world.itemA)).toBe('10.0000');
    const row = await q(db, `SELECT status FROM stock_requests WHERE id = $1`, [
      id,
    ]);
    expect(row.status).toBe('approved');
  });

  it('should raise a draft reorder PR and notify active managers and admins at the reorder point', async () => {
    const itemId = await reorderItem();
    // an inactive manager must not be notified
    await db.query(
      `INSERT INTO "user" (email, "firstName", "roleId", active) VALUES ('gone@test.local', 'Gone', 2, false)`,
    );
    const id = await seedStockRequest(db, world.employee, itemId, '6');

    await requests.fulfil(world.manager, id);

    expect(await stockOf(itemId)).toBe('4.0000');

    const pr = await q(db, `SELECT * FROM purchase_requests`);
    expect(pr).toMatchObject({
      requester_id: world.employee.id,
      status: 'draft',
      currency: 'USD',
      exchange_rate: '1.000000',
      total_original: '0.0000',
      auto_generated: true,
      note: 'Auto-reorder: SKU-R at/below reorder point',
    });
    expect(await db.query(`SELECT * FROM purchase_request_items`)).toEqual([
      expect.objectContaining({
        pr_id: pr.id,
        name: 'Printer paper',
        qty: '20.0000',
        unit_price_original: '0.0000',
        inventory_item_id: itemId,
        category: 'Supplies',
      }),
    ]);

    const notes = await db.query(
      `SELECT user_id, event, payload FROM notifications ORDER BY user_id`,
    );
    expect(notes.map((n) => n.user_id)).toEqual([
      world.admin.id,
      world.manager.id,
    ]);
    for (const note of notes) {
      expect(note.event).toBe('stock_below_reorder');
      expect(note.payload).toMatchObject({
        sku: 'SKU-R',
        name: 'Printer paper',
        purchase_request_id: pr.id,
        inventory_item_id: itemId,
      });
      expect(Number(note.payload.balance_after)).toBe(4);
      expect(Number(note.payload.reorder_point)).toBe(5);
    }
  });

  it('should not reorder above the reorder point', async () => {
    const itemId = await reorderItem();
    const id = await seedStockRequest(db, world.employee, itemId, '4');

    await requests.fulfil(world.manager, id);

    expect(await stockOf(itemId)).toBe('6.0000');
    expect(await db.query(`SELECT 1 FROM purchase_requests`)).toHaveLength(0);
    expect(await db.query(`SELECT 1 FROM notifications`)).toHaveLength(0);
  });

  it('should not reorder an item with no reorder quantity', async () => {
    const itemId = await reorderItem('0');
    const id = await seedStockRequest(db, world.employee, itemId, '8');

    await requests.fulfil(world.manager, id);

    expect(await db.query(`SELECT 1 FROM purchase_requests`)).toHaveLength(0);
  });

  it('should refuse to fulfil the same request twice', async () => {
    const id = await seedStockRequest(db, world.employee, world.itemA, '2');
    await requests.fulfil(world.manager, id);

    await expect(requests.fulfil(world.manager, id)).rejects.toThrow(
      'This request has already been fulfilled.',
    );
    expect(await stockOf(world.itemA)).toBe('8.0000');
  });

  it('should let only one of two concurrent fulfilments through when together they overdraw', async () => {
    const first = await seedStockRequest(db, world.employee, world.itemA, '6');
    const second = await seedStockRequest(db, world.employee, world.itemA, '6');

    const results = await Promise.allSettled([
      requests.fulfil(world.manager, first),
      requests.fulfil(world.admin, second),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await stockOf(world.itemA)).toBe('4.0000');
    expect(await db.query(`SELECT 1 FROM stock_movements`)).toHaveLength(1);
  });
});
