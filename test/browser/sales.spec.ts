import { expect, test } from '@playwright/test';
import { login, sql, submit } from './support';

/**
 * Sales documents through the real screens: a customer, a quotation, its conversion to
 * an invoice, issuing it, the payment and receipt, then the CSV and PDF downloads.
 */
test.describe.configure({ mode: 'serial' });

const pdfOf = async (page: import('@playwright/test').Page, path: string) => {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
};

test.describe('sales documents', () => {
  test('should save the company details printed on documents', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/admin/settings');
    await page.locator('#company_name_en').fill('ByteLab Co., Ltd.');
    await page.locator('#company_name_km').fill('ក្រុមហ៊ុន បៃថ៍ឡាប់ ឯ.ក');
    await page.locator('#company_vat_tin').fill('K001-901234567');
    await page.locator('#company_address').fill('#12, St. 271, Phnom Penh');
    await page.locator('#sales_vat_rate').fill('10');
    await page
      .locator('#company_payment_details')
      .fill('ABA Bank · Account 000 123 456 (USD)');
    await submit(page, 'Save company details');

    const [row] = await sql(
      `SELECT value FROM app_settings WHERE key = 'company_vat_tin'`,
    );
    expect(row.value).toBe('K001-901234567');
  });

  test('should add a customer from the admin tabs', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/suppliers');
    await page.getByRole('link', { name: 'Customers' }).click();
    await expect(page).toHaveURL(/\/admin\/customers/);

    await page.locator('#name').fill('Mekong Retail Co., Ltd.');
    await page.locator('#address').fill('#88, Monivong Blvd, Phnom Penh');
    await submit(page, 'Add customer');
    await expect(
      page.getByText('Mekong Retail Co., Ltd.').first(),
    ).toBeVisible();
  });

  test('should take a quotation to an invoice to a receipt', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/sales');
    await page.getByRole('link', { name: 'New quotation' }).first().click();

    await page
      .locator('#customerId')
      .selectOption({ label: 'Mekong Retail Co., Ltd.' });
    await page.locator('#item-description-0').fill('Dell Latitude laptop');
    await page.locator('#item-qty-0').fill('10');
    await page.locator('#item-price-0').fill('780');

    // The live preview redraws from the form without saving anything.
    const preview = page.frameLocator('#preview-sales-form');
    await expect(preview.getByText('Dell Latitude laptop')).toBeVisible();
    await expect(preview.getByText('8,580.00').first()).toBeVisible();
    await page.locator('#language').selectOption('en');
    await expect(preview.getByText('QUOTATION', { exact: true })).toBeVisible();
    await expect(preview.getByText('សម្រង់តម្លៃ')).toHaveCount(0);
    await page.locator('#language').selectOption('both');
    await page.locator('#discountValue').fill('10');
    await expect(preview.getByText('Discount 10%')).toBeVisible();
    await expect(preview.getByText('7,722.00').first()).toBeVisible(); // 7,020 + 10% VAT
    await page.locator('#discountValue').fill('0');

    await submit(page, 'Create quotation');

    await expect(page).toHaveURL(/\/sales\/\d+$/);
    await expect(
      page.getByRole('heading', { name: /^QT-\d{4}-0001$/ }).first(),
    ).toBeVisible();
    await expect(page.getByText('8,580.00 USD').first()).toBeVisible(); // 7,800 + 10% VAT

    await submit(page, 'Mark as sent');
    await submit(page, 'Convert to invoice');
    await expect(
      page.getByRole('heading', { name: /^INV-\d{4}-0001$/ }).first(),
    ).toBeVisible();

    await submit(page, 'Issue invoice');
    await expect(page.getByText('Invoice issued')).toBeVisible();

    await page.locator('#paymentReference').fill('ABA-88231407');
    await submit(page, 'Record payment and create receipt');
    await expect(
      page.getByRole('heading', { name: /^RCPT-\d{4}-0001$/ }).first(),
    ).toBeVisible();

    const entries = await sql(
      `SELECT source::text, COUNT(*)::int AS n FROM journal_entries
        WHERE source IN ('sales_invoice', 'sales_receipt') GROUP BY source ORDER BY source`,
    );
    expect(entries).toEqual([
      { source: 'sales_invoice', n: 1 },
      { source: 'sales_receipt', n: 1 },
    ]);
  });

  test('should download each document as a PDF and the list as CSV', async ({
    page,
  }) => {
    await login(page, 'admin');
    const ids = await sql<{ id: number }>(
      `SELECT id FROM sales_documents ORDER BY id`,
    );
    expect(ids).toHaveLength(3);
    for (const { id } of ids) await pdfOf(page, `/sales/${id}/pdf`);

    // An invoice is titled INVOICE, not TAX INVOICE.
    const printed = await page.request.get(`/sales/${ids[1].id}/print`);
    const html = await printed.text();
    expect(html).toContain('>INVOICE<');
    expect(html).not.toContain('TAX INVOICE');
    // The previous test paid it in full, so nothing is left to pay.
    expect(html).toContain('Amount paid');
    expect(html).toMatch(/Amount due \(USD\)[\s\S]*?>0\.00</);
    const quote = await (
      await page.request.get(`/sales/${ids[0].id}/print`)
    ).text();
    expect(quote).not.toContain('Amount due');
    expect(quote).not.toContain('Deposit');
    await sql(
      `UPDATE sales_documents SET deposit_value = 50, deposit_amount = total / 2 WHERE id = $1`,
      [ids[0].id],
    );
    const withDeposit = await (
      await page.request.get(`/sales/${ids[0].id}/print`)
    ).text();
    expect(withDeposit).toContain('Deposit due (50%)');
    const receipt = await (
      await page.request.get(`/sales/${ids[2].id}/print`)
    ).text();
    expect(receipt).toContain('Amount received');
    expect(receipt).toMatch(/Amount remaining[\s\S]*?>0\.00</);

    const csv = await page.request.get('/sales/export.csv');
    const text = (await csv.body()).toString();
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(text).toMatch(/QT-\d{4}-0001/);
    expect(text).toMatch(/INV-\d{4}-0001/);
    expect(text).toMatch(/RCPT-\d{4}-0001/);
    expect(text).toContain('Mekong Retail Co., Ltd.');
  });

  test('should save exactly the lines left after removing and adding on edit', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/sales/new?type=quotation');
    await page
      .locator('#customerId')
      .selectOption({ label: 'Mekong Retail Co., Ltd.' });
    for (const [index, name] of ['Laptop', 'Mouse', 'Bag'].entries()) {
      if (index > 0)
        await page.getByRole('button', { name: 'Add line' }).click();
      await page.locator(`#item-description-${index}`).fill(name);
      await page.locator(`#item-price-${index}`).fill('10');
    }
    await submit(page, 'Create quotation');
    await expect(page).toHaveURL(/\/sales\/\d+$/);
    const id = page.url().split('/').pop();

    await page.goto(`/sales/${id}/edit`);
    await page.getByRole('button', { name: 'Remove line' }).nth(1).click(); // Mouse
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.locator('#item-description-2').fill('Charger');
    await page.locator('#item-price-2').fill('10');
    await submit(page, 'Save changes');

    const items = await sql(
      `SELECT description FROM sales_document_items WHERE document_id = $1 ORDER BY id`,
      [Number(id)],
    );
    expect(items.map((item) => item.description)).toEqual([
      'Laptop',
      'Bag',
      'Charger',
    ]);
  });

  test('should keep Sales away from an employee', async ({ page }) => {
    await login(page, 'employee');
    const response = await page.goto('/sales');
    expect(response?.status()).toBe(403);
  });
});
