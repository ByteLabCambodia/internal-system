import { expect, test } from '@playwright/test';
import { login, sql, submit } from './support';

/**
 * The core operations loop, driven through the real pages: an employee asks for goods, a
 * manager approves, an order is raised and paid (with the over-payment guard), the goods
 * are received into stock, and stock is handed out (with the insufficient-stock guard).
 * Each step builds on the previous one, so they run in order.
 */
test.describe.configure({ mode: 'serial' });

test.describe('purchase to stock', () => {
  let prId: string;
  let poId: string;
  let poNumber: string;
  let itemId: string;

  test('should let a manager add a catalog item', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/inventory/new');
    await page.getByLabel('SKU').fill('PAPER-A4');
    await page.locator('#name').fill('A4 paper');
    await submit(page, 'Add item');

    const [item] = await sql(
      `SELECT id FROM inventory_items WHERE sku = 'PAPER-A4'`,
    );
    itemId = String(item.id);
  });

  test('should let an employee submit a purchase request', async ({ page }) => {
    await login(page, 'employee');
    await page.goto('/purchase-requests/new');
    await page.locator('#item-name-0').fill('A4 paper');
    await page.locator('#item-qty-0').fill('10');
    await page.locator('#item-price-0').fill('5');
    await submit(page, 'Submit for approval');

    const [created] = await sql(
      `SELECT id FROM purchase_requests ORDER BY id DESC LIMIT 1`,
    );
    prId = String(created.id);

    const [pr] = await sql(
      `SELECT status, total_original, total_usd FROM purchase_requests WHERE id = $1`,
      [prId],
    );
    expect(pr).toEqual({
      status: 'pending',
      total_original: '50.0000',
      total_usd: '50.0000',
    });
  });

  test('should let a manager approve it', async ({ page }) => {
    await login(page, 'manager');
    await page.goto(`/purchase-requests/${prId}`);
    await submit(page, 'Approve');

    const [pr] = await sql(
      `SELECT status FROM purchase_requests WHERE id = $1`,
      [prId],
    );
    expect(pr.status).toBe('approved');
  });

  test('should turn the approved request into an order', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/purchase-orders/new');
    await page.locator('#prId').selectOption(prId);
    await expect(page.locator('#po-item-name-0')).toHaveValue('A4 paper');
    await page.getByLabel('Supplier').fill('Acme Supplies');
    await submit(page, 'Create order');

    const [created] = await sql(
      `SELECT id FROM purchase_orders WHERE pr_id = $1`,
      [prId],
    );
    poId = String(created.id);

    const [po] = await sql(
      `SELECT po_number, total_usd, status, payment_status FROM purchase_orders WHERE id = $1`,
      [poId],
    );
    expect(po).toMatchObject({
      total_usd: '50.0000',
      status: 'open',
      payment_status: 'unpaid',
    });
    poNumber = po.po_number;

    // Link the order line to the catalog item so goods can be received into it.
    await sql(
      `UPDATE purchase_order_items SET inventory_item_id = $1 WHERE po_id = $2`,
      [itemId, poId],
    );
  });

  async function pay(page, amount: string) {
    await page.goto('/accounting/payments/new');
    await page.locator('#poId').selectOption(poId);
    await page.getByLabel('Amount').fill(amount);
    await submit(page, 'Record payment');
  }

  test('should record a part payment with a balanced journal entry', async ({
    page,
  }) => {
    await login(page, 'finance');
    await pay(page, '20');

    await expect(page).toHaveURL(new RegExp(`/purchase-orders/${poId}$`));

    const [payment] = await sql(
      `SELECT id, amount_usd, journal_entry_id FROM payments WHERE po_id = $1`,
      [poId],
    );
    expect(payment.amount_usd).toBe('20.0000');

    const lines = await sql(
      `SELECT a.code, l.debit_usd, l.credit_usd
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.entry_id = $1 ORDER BY l.id`,
      [payment.journal_entry_id],
    );
    expect(lines).toEqual([
      { code: expect.any(String), debit_usd: '20.0000', credit_usd: '0.0000' },
      { code: '1000', debit_usd: '0.0000', credit_usd: '20.0000' },
    ]);

    const [po] = await sql(
      `SELECT payment_status FROM purchase_orders WHERE id = $1`,
      [poId],
    );
    expect(po.payment_status).toBe('partial');
  });

  test('should refuse a payment that would over-pay the order', async ({
    page,
  }) => {
    await login(page, 'finance');
    await pay(page, '40');

    await expect(
      page.getByText(
        `Cannot record this payment: ${poNumber} has a total of $50.00 USD. $20.00 USD is already paid, and this $40.00 USD payment would bring the total paid to $60.00 USD.`,
      ),
    ).toBeVisible();

    const payments = await sql(`SELECT 1 FROM payments WHERE po_id = $1`, [
      poId,
    ]);
    expect(payments).toHaveLength(1);
  });

  test('should mark the order paid once the rest is paid', async ({ page }) => {
    await login(page, 'finance');
    await pay(page, '30');

    const [po] = await sql(
      `SELECT payment_status FROM purchase_orders WHERE id = $1`,
      [poId],
    );
    expect(po.payment_status).toBe('paid');
  });

  test('should receive the goods into stock once a manager confirms the claim', async ({
    page,
  }) => {
    await login(page, 'employee');
    await page.goto('/claims/new');
    const [line] = await sql(
      `SELECT id FROM purchase_order_items WHERE po_id = $1`,
      [poId],
    );
    await page.locator('#poItemId').selectOption(String(line.id));
    await page.getByLabel('Quantity received').fill('6');
    await submit(page, 'Submit claim');

    const [claim] = await sql(`SELECT status FROM inventory_claims`);
    expect(claim?.status).toBe('pending');

    await login(page, 'manager');
    await page.goto('/claims');
    await submit(page, 'Confirm');

    const [item] = await sql(
      `SELECT stock_qty FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    expect(item.stock_qty).toBe('6.0000');

    const [po] = await sql(`SELECT status FROM purchase_orders WHERE id = $1`, [
      poId,
    ]);
    expect(po.status).toBe('partial'); // 6 of 10 received
  });

  async function requestStock(page, qty: string): Promise<string> {
    await login(page, 'employee');
    await page.goto('/stock-requests/new');
    await page.locator('#inventoryItemId').selectOption(itemId);
    await page.getByLabel('Quantity').fill(qty);
    await submit(page, 'Submit request');

    const [request] = await sql(
      `SELECT id FROM stock_requests ORDER BY id DESC LIMIT 1`,
    );
    return String(request.id);
  }

  async function approveAndFulfil(page, id: string) {
    await login(page, 'manager');
    await page.goto(`/stock-requests/${id}`);
    await submit(page, 'Approve');
    await page.goto(`/stock-requests/${id}`);
    await submit(page, 'Fulfil');
  }

  test('should hand stock out and write the ledger row', async ({ page }) => {
    const id = await requestStock(page, '4');
    await approveAndFulfil(page, id);

    const [item] = await sql(
      `SELECT stock_qty FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    expect(item.stock_qty).toBe('2.0000');

    const movements = await sql(
      `SELECT delta, reason, balance_after FROM stock_movements
        WHERE inventory_item_id = $1 ORDER BY id`,
      [itemId],
    );
    expect(movements).toEqual([
      { delta: '6.0000', reason: 'claim', balance_after: '6.0000' },
      { delta: '-4.0000', reason: 'stock_request', balance_after: '2.0000' },
    ]);
  });

  test('should refuse to hand out more than is in stock', async ({ page }) => {
    const id = await requestStock(page, '5');
    await approveAndFulfil(page, id);

    await expect(
      page.getByText(
        'insufficient stock for PAPER-A4: 2.0000 on hand, 5.0000 requested',
      ),
    ).toBeVisible();

    const [item] = await sql(
      `SELECT stock_qty FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    expect(item.stock_qty).toBe('2.0000');
  });
});
