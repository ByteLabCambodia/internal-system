import { TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  q,
  seedPurchaseOrder,
  seedRoles,
  seedWorld,
  setSetting,
  World,
} from './support/fixtures';
import { PaymentsService } from '../../src/procurement/payments.service';
import { CurrencyEnum } from '../../src/common/enums';

/**
 * Recording a payment (formerly trigger T5): over-payment guard, expense-account
 * resolution, the cash-basis journal entry, and the PO payment-status roll-up.
 */
describe('PaymentsService.record', () => {
  let app: TestingModule;
  let db: DataSource;
  let payments: PaymentsService;
  let world: World;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    payments = app.get(PaymentsService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
  });

  const usd = (amountOriginal: number, poId?: number, extra = {}) => ({
    poId,
    amountOriginal,
    currency: CurrencyEnum.USD,
    ...extra,
  });

  const poState = (poId: number) =>
    q(db, `SELECT payment_status FROM purchase_orders WHERE id = $1`, [poId]);

  const linesOf = (entryId: number) =>
    db.query(
      `SELECT account_id, debit_usd, credit_usd, dimension_department_id, dimension_project_id
         FROM journal_lines WHERE entry_id = $1 ORDER BY id`,
      [entryId],
    );

  it('should post a balanced DR expense / CR cash entry and links it to the payment', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    const payment = await payments.record(world.finance, usd(40, po.poId));

    const row = await q(db, `SELECT * FROM payments WHERE id = $1`, [
      payment.id,
    ]);
    expect(row.amount_usd).toBe('40.0000');
    expect(row.journal_entry_id).not.toBeNull();

    const entry = await q(db, `SELECT * FROM journal_entries WHERE id = $1`, [
      row.journal_entry_id,
    ]);
    expect(entry).toMatchObject({
      memo: `Payment for ${po.poNumber}`,
      currency: 'USD',
      source: 'po_payment',
      source_ref: payment.id,
      created_by: world.finance.id,
    });

    expect(await linesOf(entry.id)).toEqual([
      {
        account_id: world.accounts.misc,
        debit_usd: '40.0000',
        credit_usd: '0.0000',
        dimension_department_id: world.departmentId,
        dimension_project_id: world.projectId,
      },
      {
        account_id: world.accounts.cash,
        debit_usd: '0.0000',
        credit_usd: '40.0000',
        dimension_department_id: world.departmentId,
        dimension_project_id: world.projectId,
      },
    ]);

    expect((await poState(po.poId)).payment_status).toBe('partial');
  });

  it('should mark the order paid once payments reach its total', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    await payments.record(world.finance, usd(60, po.poId));
    await payments.record(world.finance, usd(40, po.poId));

    expect((await poState(po.poId)).payment_status).toBe('paid');
  });

  it('should convert foreign-currency payments to USD at the current rate', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    const payment = await payments.record(world.finance, {
      poId: po.poId,
      amountOriginal: 200000,
      currency: CurrencyEnum.KHR,
    });

    const row = await q(db, `SELECT * FROM payments WHERE id = $1`, [
      payment.id,
    ]);
    expect(row.exchange_rate).toBe('4000.000000');
    expect(row.amount_usd).toBe('50.0000');

    const entry = await q(db, `SELECT * FROM journal_entries WHERE id = $1`, [
      row.journal_entry_id,
    ]);
    expect(entry.currency).toBe('KHR');
    expect(entry.exchange_rate).toBe('4000.000000');
  });

  it("should debit the order's own expense account ahead of the default", async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '1', '10']],
      expenseAccountId: world.accounts.supplies,
    });

    const payment = await payments.record(world.finance, usd(10, po.poId));
    const row = await q(
      db,
      `SELECT journal_entry_id FROM payments WHERE id = $1`,
      [payment.id],
    );

    expect((await linesOf(row.journal_entry_id))[0].account_id).toBe(
      world.accounts.supplies,
    );
  });

  it('should book a direct expense (no order) against the chosen account', async () => {
    const payment = await payments.record(
      world.finance,
      usd(25, undefined, { expenseAccountId: world.accounts.supplies }),
    );

    const row = await q(db, `SELECT * FROM payments WHERE id = $1`, [
      payment.id,
    ]);
    const entry = await q(db, `SELECT * FROM journal_entries WHERE id = $1`, [
      row.journal_entry_id,
    ]);
    expect(entry.memo).toBe('Payment (direct expense)');

    const lines = await linesOf(entry.id);
    expect(lines[0]).toMatchObject({
      account_id: world.accounts.supplies,
      debit_usd: '25.0000',
      dimension_department_id: null,
    });
    expect(lines[1]).toMatchObject({
      account_id: world.accounts.cash,
      credit_usd: '25.0000',
    });
  });

  it('should reject a first payment larger than the order', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    await expect(
      payments.record(world.finance, usd(150, po.poId)),
    ).rejects.toThrow(
      new UnprocessableEntityException(
        `Cannot record this payment: ${po.poNumber} has a total of $100.00 USD, and this $150.00 USD payment exceeds it.`,
      ),
    );

    expect(await db.query(`SELECT 1 FROM payments`)).toHaveLength(0);
    expect(await db.query(`SELECT 1 FROM journal_entries`)).toHaveLength(0);
  });

  it('should reject a payment that would push the total paid past the order', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });
    await payments.record(world.finance, usd(60, po.poId));

    await expect(
      payments.record(world.finance, usd(50, po.poId)),
    ).rejects.toThrow(
      `Cannot record this payment: ${po.poNumber} has a total of $100.00 USD. $60.00 USD is already paid, and this $50.00 USD payment would bring the total paid to $110.00 USD.`,
    );

    expect(await db.query(`SELECT 1 FROM payments`)).toHaveLength(1);
    expect((await poState(po.poId)).payment_status).toBe('partial');
  });

  it('should allow over-payment within payment_tolerance_pct', async () => {
    await setSetting(db, 'payment_tolerance_pct', '0.05');
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    await payments.record(world.finance, usd(105, po.poId));
    await expect(
      payments.record(world.finance, usd(0.01, po.poId)),
    ).rejects.toThrow(UnprocessableEntityException);

    expect((await poState(po.poId)).payment_status).toBe('paid');
  });

  it('should refuse to post when the chart of accounts is missing', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '1', '10']],
    });
    await db.query(`DELETE FROM accounts WHERE code = '1000'`);

    await expect(
      payments.record(world.finance, usd(10, po.poId)),
    ).rejects.toThrow(
      'chart of accounts is not seeded: 1000 and 6900 are required',
    );
  });

  it('should let only one of two concurrent payments through when together they over-pay', async () => {
    const po = await seedPurchaseOrder(db, world, {
      lines: [[world.itemA, '10', '10']],
    });

    const results = await Promise.allSettled([
      payments.record(world.finance, usd(60, po.poId)),
      payments.record(world.admin, usd(60, po.poId)),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const paid = await q(
      db,
      `SELECT sum(amount_usd) AS total FROM payments WHERE po_id = $1`,
      [po.poId],
    );
    expect(paid.total).toBe('60.0000');
  });
});
