import { TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  PoFixture,
  q,
  seedPurchaseOrder,
  seedRoles,
  seedWorld,
  setSetting,
  World,
} from './support/fixtures';
import { ClaimsService } from '../../src/inventory/claims.service';

/**
 * Confirming a goods-received claim (formerly trigger T3): over-receipt guard, stock in,
 * the movement ledger, and rolling the PO line and the PO forward.
 */
describe('ClaimsService.confirm', () => {
  let app: TestingModule;
  let db: DataSource;
  let claims: ClaimsService;
  let world: World;
  let po: PoFixture;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    claims = app.get(ClaimsService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
    // line 0: 10 × SKU-A (stock 10), line 1: 4 × SKU-B (stock 0)
    po = await seedPurchaseOrder(db, world, {
      lines: [
        [world.itemA, '10', '5'],
        [world.itemB, '4', '5'],
      ],
    });
  });

  const claim = async (line: number, qty: number) =>
    (
      await claims.create(world.employee, {
        poItemId: po.lineIds[line],
        qtyClaimed: qty,
      })
    ).id;

  const stockOf = async (itemId: number) =>
    (
      await q(db, `SELECT stock_qty FROM inventory_items WHERE id = $1`, [
        itemId,
      ])
    ).stock_qty;

  const poStatus = async () =>
    (await q(db, `SELECT status FROM purchase_orders WHERE id = $1`, [po.poId]))
      .status;

  it('should move stock in, writes the ledger row and advances the PO line', async () => {
    const id = await claim(0, 6);

    await claims.confirm(world.manager, id);

    expect(await stockOf(world.itemA)).toBe('16.0000');

    const row = await q(db, `SELECT * FROM inventory_claims WHERE id = $1`, [
      id,
    ]);
    expect(row.status).toBe('confirmed');
    expect(row.confirmed_by).toBe(world.manager.id);
    expect(row.confirmed_at).not.toBeNull();

    expect(await db.query(`SELECT * FROM stock_movements`)).toEqual([
      expect.objectContaining({
        inventory_item_id: world.itemA,
        delta: '6.0000',
        reason: 'claim',
        ref_table: 'inventory_claims',
        ref_id: id,
        balance_after: '16.0000',
        created_by: world.manager.id,
      }),
    ]);

    const line = await q(
      db,
      `SELECT qty_claimed FROM purchase_order_items WHERE id = $1`,
      [po.lineIds[0]],
    );
    expect(line.qty_claimed).toBe('6.0000');
    expect(await poStatus()).toBe('partial');
  });

  it("should receive into the line's own item when the form posts an empty item choice", async () => {
    // The claim form hides "Receive into" for a linked line but still submits it empty,
    // which the DTO turns into 0.
    const claim = await claims.create(world.employee, {
      poItemId: po.lineIds[0],
      qtyClaimed: 2,
      inventoryItemId: 0,
    });

    const row = await q(
      db,
      `SELECT inventory_item_id FROM inventory_claims WHERE id = $1`,
      [claim.id],
    );
    expect(row.inventory_item_id).toBe(world.itemA);
  });

  it('should complete the PO once every line is fully received', async () => {
    await claims.confirm(world.manager, await claim(0, 10));
    expect(await poStatus()).toBe('partial');

    await claims.confirm(world.manager, await claim(1, 4));
    expect(await poStatus()).toBe('complete');
    expect(await stockOf(world.itemB)).toBe('4.0000');
  });

  it('should leave a cancelled PO cancelled', async () => {
    const id = await claim(0, 3);
    await db.query(
      `UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`,
      [po.poId],
    );

    await claims.confirm(world.manager, id);

    expect(await poStatus()).toBe('cancelled');
    expect(await stockOf(world.itemA)).toBe('13.0000');
  });

  it('should reject confirming past the ordered quantity, even if each claim fit when filed', async () => {
    const first = await claim(0, 6);
    const second = await claim(0, 6);
    await claims.confirm(world.manager, first);

    await expect(claims.confirm(world.manager, second)).rejects.toThrow(
      new UnprocessableEntityException(
        `over-receipt on purchase order line ${po.lineIds[0]}: 6.0000 already claimed + 6.0000 exceeds 10.0000 ordered`,
      ),
    );

    expect(await stockOf(world.itemA)).toBe('16.0000');
    const row = await q(
      db,
      `SELECT status FROM inventory_claims WHERE id = $1`,
      [second],
    );
    expect(row.status).toBe('pending');
  });

  it('should allow over-receipt within receipt_tolerance_pct', async () => {
    await setSetting(db, 'receipt_tolerance_pct', '0.1');
    const first = await claim(0, 6);
    const second = await claim(0, 5);

    await claims.confirm(world.manager, first);
    await claims.confirm(world.manager, second);

    expect(await stockOf(world.itemA)).toBe('21.0000');
    expect(await poStatus()).toBe('partial'); // line 1 still outstanding
  });

  it('should refuse to confirm the same claim twice', async () => {
    const id = await claim(0, 2);
    await claims.confirm(world.manager, id);

    await expect(claims.confirm(world.manager, id)).rejects.toThrow(
      'This claim is already confirmed.',
    );
    expect(await stockOf(world.itemA)).toBe('12.0000');
  });

  it('should let only one of two concurrent confirmations through when together they over-receive', async () => {
    const first = await claim(0, 6);
    const second = await claim(0, 6);

    const results = await Promise.allSettled([
      claims.confirm(world.manager, first),
      claims.confirm(world.admin, second),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await stockOf(world.itemA)).toBe('16.0000');
    expect(await db.query(`SELECT 1 FROM stock_movements`)).toHaveLength(1);
  });
});
