import { renderFile } from 'ejs';
import { join } from 'path';

// The invoice's totals rows, as [label, amount] pairs, for a $7,650 invoice.
async function totals(extra: Record<string, unknown>): Promise<string[][]> {
  const money = {
    format: (value: unknown) =>
      Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 }),
  };
  const doc = {
    type: 'invoice',
    status: 'issued',
    language: 'en',
    currency: 'USD',
    issueDate: new Date(),
    subtotal: 7650,
    discountAmount: 0,
    vatRate: 0,
    vatAmount: 0,
    total: 7650,
    exchangeRate: 1,
    items: [],
    customer: {},
    depositType: 'percent',
    depositValue: 50,
    depositAmount: 3825,
    derived: [],
    ...extra,
  };
  const html = await renderFile(join(__dirname, '../views/sales/print.ejs'), {
    doc,
    money,
    khrRate: null,
    company: {},
    logo: null,
    preview: false,
  });
  return html
    .split('<tfoot>')[1]
    .split('</tfoot>')[0]
    .split('</tr>')
    .map((row) =>
      row
        .split('</td>')
        .map((cell) => cell.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean),
    )
    .filter((cells) => cells.length === 2)
    .slice(1); // drop Subtotal
}

const receipt = (total: number, status = 'issued') => ({
  type: 'receipt',
  status,
  total,
});

describe('invoice print totals', () => {
  it('should show only the amount due without a deposit', async () => {
    expect(await totals({ depositAmount: 0, depositValue: 0 })).toEqual([
      ['VAT 0%', '0.00'],
      ['Grand total (USD)', '7,650.00'],
      ['Amount paid', '0.00'],
      ['Amount due (USD)', '7,650.00'],
    ]);
  });

  it('should split an unpaid deposit from the final payment', async () => {
    expect((await totals({})).slice(2)).toEqual([
      ['Amount paid', '0.00'],
      ['Amount due (USD)', '7,650.00'],
      ['Deposit due (50%)', '3,825.00'],
      ['Final payment', '3,825.00'],
    ]);
  });

  it('should count a part payment toward the deposit first', async () => {
    expect((await totals({ derived: [receipt(2000)] })).slice(2)).toEqual([
      ['Amount paid', '2,000.00'],
      ['Amount due (USD)', '5,650.00'],
      ['Deposit due (50%)', '1,825.00'],
      ['Final payment', '3,825.00'],
    ]);
  });

  it('should call the rest the final payment once the deposit is paid', async () => {
    expect((await totals({ derived: [receipt(3825)] })).slice(2)).toEqual([
      ['Amount paid', '3,825.00'],
      ['Final payment (USD)', '3,825.00'],
    ]);
    expect((await totals({ derived: [receipt(5000)] })).slice(2)).toEqual([
      ['Amount paid', '5,000.00'],
      ['Final payment (USD)', '2,650.00'],
    ]);
  });

  it('should show nothing due when paid in full', async () => {
    expect(
      (await totals({ derived: [receipt(3825), receipt(3825)] })).slice(2),
    ).toEqual([
      ['Amount paid', '7,650.00'],
      ['Amount due (USD)', '0.00'],
    ]);
  });

  it('should ignore a voided deposit receipt', async () => {
    expect(
      (await totals({ derived: [receipt(3825, 'void')] })).slice(2),
    ).toEqual([
      ['Amount paid', '0.00'],
      ['Amount due (USD)', '7,650.00'],
      ['Deposit due (50%)', '3,825.00'],
      ['Final payment', '3,825.00'],
    ]);
  });
});
