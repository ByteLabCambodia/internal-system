import { TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { createTestApp, resetData } from './support/test-app';
import { TestDb } from './support/test-db';
import { q, seedRoles, seedWorld, World } from './support/fixtures';
import { SalesService } from '../../src/sales/sales.service';
import { PdfService } from '../../src/sales/pdf.service';
import {
  CurrencyEnum,
  DiscountTypeEnum,
  PaymentMethodEnum,
  SalesDocLanguageEnum,
  SalesDocStatusEnum,
  SalesDocTypeEnum,
} from '../../src/common/enums';
import { SalesDocumentDto } from '../../src/sales/dto/sales-document.dto';

/** Quotation → invoice → receipt: numbering, totals, ledger postings and the PDF. */
describe('SalesService', () => {
  let app: TestingModule;
  let db: TestDb;
  let sales: SalesService;
  let world: World;
  let customerId: number;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(TestDb);
    sales = app.get(SalesService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
    for (const [code, name, type] of [
      ['1100', 'Accounts Receivable', 'asset'],
      ['2100', 'VAT Payable', 'liability'],
      ['4000', 'Sales income', 'income'],
    ]) {
      await db.query(
        `INSERT INTO accounts (code, name, type) VALUES ($1, $2, $3)`,
        [code, name, type],
      );
    }
    customerId = (
      await q(
        db,
        `INSERT INTO customers (name) VALUES ('Mekong Retail') RETURNING id`,
      )
    ).id;
  });

  const quotation = (overrides: Partial<SalesDocumentDto> = {}) =>
    ({
      type: SalesDocTypeEnum.quotation,
      customerId,
      issueDate: '2026-10-10',
      currency: CurrencyEnum.USD,
      language: SalesDocLanguageEnum.both,
      vatRate: 10,
      items: [
        { description: 'Laptop', qty: 10, unitPrice: 780 },
        { description: 'Setup', qty: 10, unitPrice: 15 },
        { description: 'Delivery', qty: 1, unitPrice: 50 },
      ],
      ...overrides,
    }) as SalesDocumentDto;

  const balances = (code: string) =>
    q(
      db,
      `SELECT COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS net
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = $1`,
      [code],
    ).then((row) => row.net);

  it('should number each type from its own sequence and total with VAT', async () => {
    const first = await sales.create(world.finance, quotation());
    const second = await sales.create(world.finance, quotation());

    const doc = await sales.findOne(first);
    expect(doc.customer.code).toMatch(/^C-\d{4}$/);
    const code = doc.customer.code.slice(2);
    expect(doc.number).toBe(`QT-${code}-0001`);
    expect((await sales.findOne(second)).number).toBe(`QT-${code}-0002`);

    // Each customer counts its own quotes, and a draft moved to another customer
    // takes that customer's next number.
    const otherId = (
      await q(
        db,
        `INSERT INTO customers (name) VALUES ('Angkor Foods') RETURNING id`,
      )
    ).id;
    const other = await sales.findOne(
      await sales.create(world.finance, quotation({ customerId: otherId })),
    );
    expect(other.customer.code).not.toBe(doc.customer.code);
    expect(other.number).toBe(`QT-${other.customer.code.slice(2)}-0001`);
    await sales.update(
      world.finance,
      second,
      quotation({ customerId: otherId }),
    );
    expect((await sales.findOne(second)).number).toBe(
      `QT-${other.customer.code.slice(2)}-0002`,
    );
    expect(doc.subtotal).toBe('8000.0000');
    expect(doc.vatAmount).toBe('800.0000');
    expect(doc.total).toBe('8800.0000');
    expect(doc.items).toHaveLength(3);
  });

  it('should refuse to convert a draft quotation, then convert a sent one once', async () => {
    const id = await sales.create(world.finance, quotation());

    await expect(sales.convertToInvoice(world.finance, id)).rejects.toThrow(
      UnprocessableEntityException,
    );

    await sales.setStatus(world.finance, id, SalesDocStatusEnum.sent);
    const invoiceId = await sales.convertToInvoice(world.finance, id);
    const invoice = await sales.findOne(invoiceId);

    expect(invoice.number).toBe(`INV-${invoice.customer.code.slice(2)}-0001`);
    expect(invoice.type).toBe(SalesDocTypeEnum.invoice);
    expect(invoice.sourceId).toBe(id);
    expect(invoice.total).toBe('8800.0000');
    expect(invoice.items).toHaveLength(3);
    expect((await sales.findOne(id)).status).toBe(SalesDocStatusEnum.accepted);

    await expect(sales.convertToInvoice(world.finance, id)).rejects.toThrow(
      'already has an invoice',
    );
  });

  it('should post DR receivable / CR income + VAT when an invoice is issued, once', async () => {
    const id = await sales.create(
      world.finance,
      quotation({ type: SalesDocTypeEnum.invoice, dueDate: '2026-11-09' }),
    );

    await sales.issueInvoice(world.finance, id);

    expect(await balances('1100')).toBe('8800.0000');
    expect(await balances('4000')).toBe('-8000.0000');
    expect(await balances('2100')).toBe('-800.0000');
    expect((await sales.findOne(id)).status).toBe(SalesDocStatusEnum.issued);

    await expect(sales.issueInvoice(world.finance, id)).rejects.toThrow(
      'already issued',
    );
    await expect(sales.update(world.finance, id, quotation())).rejects.toThrow(
      'only drafts',
    );
  });

  it('should settle receivable into cash with a receipt and mark the invoice paid', async () => {
    const id = await sales.create(
      world.finance,
      quotation({ type: SalesDocTypeEnum.invoice }),
    );

    await expect(
      sales.recordReceipt(world.finance, id, {
        paidOn: '2026-11-20',
        paymentMethod: PaymentMethodEnum.bank_transfer,
      }),
    ).rejects.toThrow('issue it before');

    await sales.issueInvoice(world.finance, id);
    const receiptId = await sales.recordReceipt(world.finance, id, {
      paidOn: '2026-11-20',
      paymentMethod: PaymentMethodEnum.bank_transfer,
      paymentReference: 'ABA-88231407',
    });

    const receipt = await sales.findOne(receiptId);
    expect(receipt.number).toBe(`RCPT-${receipt.customer.code.slice(2)}-0001`);
    expect(receipt.sourceId).toBe(id);
    expect(receipt.paymentReference).toBe('ABA-88231407');
    // The receipt prints the paid invoice's lines, so findOne carries them on `source`.
    expect(receipt.source?.items).toHaveLength(3);
    expect((await sales.findOne(id)).status).toBe(SalesDocStatusEnum.paid);
    expect(await balances('1000')).toBe('8800.0000');
    expect(await balances('1100')).toBe('0.0000');

    await expect(
      sales.recordReceipt(world.finance, id, {
        paidOn: '2026-11-21',
        paymentMethod: PaymentMethodEnum.cash,
      }),
    ).rejects.toThrow('already paid');
  });

  it('should take an invoice in instalments and mark it paid only when nothing is left', async () => {
    const id = await sales.create(
      world.finance,
      quotation({ type: SalesDocTypeEnum.invoice }),
    );
    await sales.issueInvoice(world.finance, id);
    const pay = (amount?: number) =>
      sales.recordReceipt(world.finance, id, {
        paidOn: '2026-11-20',
        paymentMethod: PaymentMethodEnum.cash,
        amount,
      });

    const firstId = await pay(4400);
    expect((await sales.findOne(firstId)).total).toBe('4400.0000');
    expect((await sales.findOne(id)).status).toBe(SalesDocStatusEnum.issued);
    expect(await balances('1000')).toBe('4400.0000');
    expect(await balances('1100')).toBe('4400.0000');

    await expect(pay(4400.01)).rejects.toThrow('still due');
    await expect(pay(0)).rejects.toThrow('still due');

    // No amount: pay whatever is left.
    const secondId = await pay();
    const second = await sales.findOne(secondId);
    expect(second.total).toBe('4400.0000');
    expect(second.number).toMatch(/-0002$/);
    expect(second.source?.derived).toHaveLength(2);
    expect((await sales.findOne(id)).status).toBe(SalesDocStatusEnum.paid);
    expect(await balances('1000')).toBe('8800.0000');
    expect(await balances('1100')).toBe('0.0000');
    await expect(pay(1)).rejects.toThrow('already paid');
  });

  it('should lock the current rate for a KHR document and refuse a currency with no rate', async () => {
    const id = await sales.create(
      world.finance,
      quotation({ currency: CurrencyEnum.KHR, vatRate: 0 }),
    );
    const doc = await sales.findOne(id);
    expect(Number(doc.exchangeRate)).toBe(4000);
    expect(doc.totalUsd).toBe('2.0000'.replace('2', String(8000 / 4000)));

    await expect(
      sales.create(world.finance, quotation({ currency: CurrencyEnum.CNY })),
    ).rejects.toThrow('No exchange rate');
  });

  it('should take a percentage discount off before VAT and post the net as income', async () => {
    const id = await sales.create(
      world.finance,
      quotation({
        type: SalesDocTypeEnum.invoice,
        discountType: DiscountTypeEnum.percent,
        discountValue: 10,
      }),
    );

    const doc = await sales.findOne(id);
    expect(doc.subtotal).toBe('8000.0000');
    expect(doc.discountAmount).toBe('800.0000');
    expect(doc.vatAmount).toBe('720.0000'); // 10% of 7,200, not of 8,000
    expect(doc.total).toBe('7920.0000');

    await sales.issueInvoice(world.finance, id);
    expect(await balances('1100')).toBe('7920.0000');
    expect(await balances('4000')).toBe('-7200.0000');
    expect(await balances('2100')).toBe('-720.0000');
  });

  it('should take a fixed discount, and refuse one larger than the subtotal', async () => {
    const id = await sales.create(
      world.finance,
      quotation({ discountType: DiscountTypeEnum.amount, discountValue: 500 }),
    );
    const doc = await sales.findOne(id);
    expect(doc.discountAmount).toBe('500.0000');
    expect(doc.total).toBe('8250.0000'); // (8,000 - 500) + 10% VAT

    await expect(
      sales.create(
        world.finance,
        quotation({
          discountType: DiscountTypeEnum.amount,
          discountValue: 9000,
        }),
      ),
    ).rejects.toThrow('more than the subtotal');
  });

  it('should carry the language and discount from quotation to invoice to receipt', async () => {
    const id = await sales.create(
      world.finance,
      quotation({
        language: SalesDocLanguageEnum.km,
        discountType: DiscountTypeEnum.percent,
        discountValue: 5,
      }),
    );
    await sales.setStatus(world.finance, id, SalesDocStatusEnum.sent);
    const invoiceId = await sales.convertToInvoice(world.finance, id);
    await sales.issueInvoice(world.finance, invoiceId);
    const receiptId = await sales.recordReceipt(world.finance, invoiceId, {
      paidOn: '2026-11-20',
      paymentMethod: PaymentMethodEnum.cash,
    });

    for (const docId of [invoiceId, receiptId]) {
      const doc = await sales.findOne(docId);
      expect(doc.language).toBe(SalesDocLanguageEnum.km);
      expect(doc.discountAmount).toBe('400.0000');
      expect(doc.total).toBe('8360.0000'); // (8,000 - 400) + 10% VAT
    }
  });

  it('should print a real PDF', async () => {
    const id = await sales.create(world.finance, quotation());
    const doc = await sales.findOne(id);
    const pdf = await app
      .get(PdfService)
      .fromHtml(`<html><body><h1>${doc.number} វិក្កយបត្រ</h1></body></html>`);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
