import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Decimal from 'decimal.js';
import { and, or } from '@prisma/orm-postgres/orm-client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { money, rate } from '../prisma/numeric';
import { contains } from '../prisma/like';
import { textRow } from '../prisma/raw';
import {
  CurrencyEnum,
  DiscountTypeEnum,
  JournalSourceEnum,
  SalesDocStatusEnum,
  SalesDocTypeEnum,
} from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { ActivityService } from '../activity/activity.service';
import { JournalService } from '../accounting/journal.service';
import { RatesService } from '../accounting/rates.service';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/domain/user';
import { RecordReceiptDto, SalesDocumentDto } from './dto/sales-document.dto';

export type SalesListFilters = {
  type?: SalesDocTypeEnum;
  status?: SalesDocStatusEnum;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
};

const PREFIX: Record<SalesDocTypeEnum, string> = {
  quotation: 'QT',
  invoice: 'INV',
  receipt: 'RCPT',
};

/** Status changes a user can make by hand; issue, convert and receipt have their own flows. */
const MANUAL_TRANSITIONS: Partial<
  Record<
    SalesDocTypeEnum,
    Partial<Record<SalesDocStatusEnum, SalesDocStatusEnum[]>>
  >
> = {
  quotation: {
    draft: [SalesDocStatusEnum.sent, SalesDocStatusEnum.void],
    sent: [
      SalesDocStatusEnum.accepted,
      SalesDocStatusEnum.rejected,
      SalesDocStatusEnum.void,
    ],
  },
  // An issued invoice is in the ledger; voiding it would need a reversing entry.
  invoice: { draft: [SalesDocStatusEnum.void] },
};

export const ACCOUNTS = {
  cash: '1000',
  receivable: '1100',
  vatPayable: '2100',
  income: '4000',
} as const;

/** Seller details printed on every document, edited under Admin → Settings. */
export const COMPANY_SETTINGS = {
  company_name_km: '',
  company_name_en: '',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_vat_tin: '',
  company_payment_details: '',
  sales_vat_rate: '10',
  sales_default_language: 'both',
} as const;
export type CompanyProfile = Record<keyof typeof COMPANY_SETTINGS, string>;

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly activity: ActivityService,
    private readonly journal: JournalService,
    private readonly rates: RatesService,
    private readonly settings: SettingsService,
  ) {}

  private get documents() {
    return this.prisma.db.orm.public.SalesDocument;
  }

  async company(): Promise<CompanyProfile> {
    const entries = await Promise.all(
      Object.entries(COMPANY_SETTINGS).map(
        async ([key, fallback]) =>
          [key, await this.settings.get(key, fallback)] as const,
      ),
    );
    return Object.fromEntries(entries) as CompanyProfile;
  }

  async list(filters: SalesListFilters) {
    const { search, from, to } = filters;
    const documents = this.documents.where((d) =>
      and(
        ...(filters.type ? [d.type.eq(filters.type)] : []),
        ...(filters.status ? [d.status.eq(filters.status)] : []),
        ...(search
          ? [
              or(
                d.number.ilike(contains(search)),
                d.customer.some((c) => c.name.ilike(contains(search))),
              ),
            ]
          : []),
        ...(from ? [d.issueDate.gte(from)] : []),
        ...(to ? [d.issueDate.lte(to)] : []),
      ),
    );

    const [rows, total] = await Promise.all([
      documents
        .include('customer')
        .include('source')
        .orderBy([(d) => d.issueDate.desc(), (d) => d.id.desc()])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      documents.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findOne(id: number) {
    const row = await this.documents
      .where({ id })
      .include('customer')
      .include('source', (source) =>
        source.include('items', (items) => items.orderBy((i) => i.id.asc())),
      )
      .include('derived', (d) => d.orderBy((x) => x.id.asc()))
      .include('createdBy')
      .include('items', (items) => items.orderBy((i) => i.id.asc()))
      .first();

    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  /**
   * QT-0001 / INV-0001 / RCPT-0001 from the type's own sequence. Callers take it only
   * after their checks pass. shortcut: an insert that fails afterwards (e.g. a customer
   * deleted mid-request) still leaves a gap; if GDT audits gaps, assign numbers from a
   * locked counter row inside the transaction instead.
   */
  private async nextNumber(type: SalesDocTypeEnum): Promise<string> {
    const db = this.prisma.db;
    const [row] = await db
      .runtime()
      .query(
        db.raw.sql`SELECT nextval(${`${type}_number_seq`}::regclass)::text AS n`
          .returnsRow(textRow('n'))
          .build(),
      );
    return `${PREFIX[type]}-${row.n.padStart(4, '0')}`;
  }

  /**
   * Line amounts, subtotal, discount, VAT and total, all 4dp strings through MoneyService.
   * The discount comes off the subtotal and VAT is charged on what is left.
   */
  totals(
    items: { qty: number | string; unitPrice: number | string }[],
    vatRate: number | string,
    discount: { type: DiscountTypeEnum; value: number | string } = {
      type: DiscountTypeEnum.percent,
      value: 0,
    },
  ) {
    const lines = items.map((item) =>
      this.money.lineTotal(item.qty, item.unitPrice),
    );
    const subtotal = this.money.sum(lines);
    const discountAmount = this.money.round(
      discount.type === DiscountTypeEnum.percent
        ? new Decimal(subtotal).times(discount.value).dividedBy(100)
        : discount.value,
    );

    if (new Decimal(discountAmount).greaterThan(subtotal)) {
      throw new UnprocessableEntityException(
        'The discount is more than the subtotal.',
      );
    }

    const net = this.money.round(new Decimal(subtotal).minus(discountAmount));
    const vatAmount = this.money.round(
      new Decimal(net).times(vatRate).dividedBy(100),
    );
    return {
      lines,
      subtotal,
      discountAmount,
      vatAmount,
      total: this.money.add(net, vatAmount),
    };
  }

  private async lockedRate(currency: CurrencyEnum): Promise<string> {
    const exchangeRate = await this.rates.getCurrentRate(currency);
    if (!exchangeRate) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for ${currency}. Set today's rate under Accounting first.`,
      );
    }
    return exchangeRate;
  }

  private async writeItems(
    tx: Tx,
    documentId: number,
    dto: SalesDocumentDto,
    lines: string[],
  ) {
    await tx.orm.public.SalesDocumentItem.createAll(
      dto.items.map((item, index) => ({
        documentId,
        description: item.description.trim(),
        detail: item.detail?.trim() || null,
        qty: money(String(item.qty)),
        unitPrice: money(String(item.unitPrice)),
        amount: money(lines[index]),
      })),
    );
  }

  private header(dto: SalesDocumentDto, exchangeRate: string) {
    const discountType = dto.discountType ?? DiscountTypeEnum.percent;
    const discountValue = dto.discountValue ?? 0;
    const { lines, subtotal, discountAmount, vatAmount, total } = this.totals(
      dto.items,
      dto.vatRate,
      { type: discountType, value: discountValue },
    );
    return {
      lines,
      data: {
        customerId: dto.customerId,
        issueDate: dto.issueDate,
        dueDate:
          dto.type === SalesDocTypeEnum.invoice ? dto.dueDate || null : null,
        currency: dto.currency,
        exchangeRate: rate(exchangeRate),
        language: dto.language,
        discountType,
        discountValue: money(this.money.round(discountValue)),
        discountAmount: money(discountAmount),
        vatRate: money(this.money.round(dto.vatRate)),
        subtotal: money(subtotal),
        vatAmount: money(vatAmount),
        total: money(total),
        totalUsd: money(this.money.toUsd(total, exchangeRate)),
        notes: dto.notes?.trim() || null,
      },
    };
  }

  async create(actor: User, dto: SalesDocumentDto): Promise<number> {
    const exchangeRate = await this.lockedRate(dto.currency);
    const { lines, data } = this.header(dto, exchangeRate);
    const number = await this.nextNumber(dto.type);

    const id = await this.prisma.db.transaction(async (tx) => {
      const doc = await tx.orm.public.SalesDocument.create({
        ...data,
        type: dto.type,
        number,
        status: SalesDocStatusEnum.draft,
        createdById: Number(actor.id),
      });
      await this.writeItems(tx, doc.id, dto, lines);
      return doc.id;
    });

    await this.log(actor, id, 'created', { number, total: data.total });
    return id;
  }

  /** Drafts only: once sent or issued, the document is what the customer holds. */
  async update(actor: User, id: number, dto: SalesDocumentDto): Promise<void> {
    const doc = await this.findOne(id);
    if (doc.status !== SalesDocStatusEnum.draft) {
      throw new UnprocessableEntityException(
        `${doc.number} is ${doc.status}; only drafts can be edited.`,
      );
    }

    const exchangeRate = await this.lockedRate(dto.currency);
    const { lines, data } = this.header(
      { ...dto, type: doc.type as SalesDocumentDto['type'] },
      exchangeRate,
    );

    await this.prisma.db.transaction(async (tx) => {
      await tx.orm.public.SalesDocument.where({ id }).update(data);
      await tx.orm.public.SalesDocumentItem.where({
        documentId: id,
      }).deleteAll();
      await this.writeItems(tx, id, dto, lines);
    });

    await this.log(actor, id, 'updated');
  }

  allowedTransitions(doc: {
    type: string;
    status: string;
  }): SalesDocStatusEnum[] {
    return (
      MANUAL_TRANSITIONS[doc.type as SalesDocTypeEnum]?.[
        doc.status as SalesDocStatusEnum
      ] ?? []
    );
  }

  async setStatus(
    actor: User,
    id: number,
    status: SalesDocStatusEnum,
  ): Promise<void> {
    const doc = await this.findOne(id);
    if (!this.allowedTransitions(doc).includes(status)) {
      throw new UnprocessableEntityException(
        `${doc.number} cannot go from ${doc.status} to ${status}.`,
      );
    }
    await this.documents.where({ id }).update({ status });
    await this.log(actor, id, status);
  }

  /** Accepted (or sent) quotation → draft invoice with the same lines, due in 30 days. */
  async convertToInvoice(actor: User, quotationId: number): Promise<number> {
    const quote = await this.findOne(quotationId);
    if (quote.type !== SalesDocTypeEnum.quotation) {
      throw new UnprocessableEntityException(
        'Only a quotation can be converted to an invoice.',
      );
    }
    if (
      ![SalesDocStatusEnum.sent, SalesDocStatusEnum.accepted].includes(
        quote.status as SalesDocStatusEnum,
      )
    ) {
      throw new UnprocessableEntityException(
        `${quote.number} is ${quote.status}; send it before converting.`,
      );
    }
    if (
      quote.derived.some(
        (d) =>
          d.type === SalesDocTypeEnum.invoice &&
          d.status !== SalesDocStatusEnum.void,
      )
    ) {
      throw new UnprocessableEntityException(
        `${quote.number} already has an invoice.`,
      );
    }

    const due = new Date();
    due.setDate(due.getDate() + 30);
    const number = await this.nextNumber(SalesDocTypeEnum.invoice);

    const id = await this.prisma.db.transaction(async (tx) => {
      const invoice = await tx.orm.public.SalesDocument.create({
        type: SalesDocTypeEnum.invoice,
        number,
        status: SalesDocStatusEnum.draft,
        customerId: quote.customerId,
        sourceId: quote.id,
        issueDate: today(),
        dueDate: due.toISOString().slice(0, 10),
        // The customer accepted these figures, so the quote's rate carries over.
        currency: quote.currency,
        exchangeRate: rate(quote.exchangeRate),
        language: quote.language,
        discountType: quote.discountType,
        discountValue: money(quote.discountValue),
        discountAmount: money(quote.discountAmount),
        vatRate: money(quote.vatRate),
        subtotal: money(quote.subtotal),
        vatAmount: money(quote.vatAmount),
        total: money(quote.total),
        totalUsd: money(quote.totalUsd),
        notes: quote.notes,
        createdById: Number(actor.id),
      });

      await tx.orm.public.SalesDocumentItem.createAll(
        quote.items.map((item) => ({
          documentId: invoice.id,
          description: item.description,
          detail: item.detail,
          qty: money(item.qty),
          unitPrice: money(item.unitPrice),
          amount: money(item.amount),
        })),
      );

      await tx.orm.public.SalesDocument.where({ id: quote.id }).update({
        status: SalesDocStatusEnum.accepted,
      });

      return invoice.id;
    });

    await this.log(actor, id, 'created', {
      number,
      fromQuotation: quote.number,
    });
    return id;
  }

  private async account(tx: Tx, code: string) {
    const row = await tx.orm.public.Account.where({ code }).first();
    if (!row) {
      throw new UnprocessableEntityException(
        `The chart of accounts is missing ${code}. Run the migrations and seed.`,
      );
    }
    return row.id;
  }

  /**
   * Draft → issued: DR 1100 receivable / CR 4000 income + CR 2100 VAT payable.
   * With postIncome false the invoice is issued without touching the ledger (and its
   * receipt then skips the ledger too, so cash never posts against a receivable that
   * was never booked).
   */
  async issueInvoice(
    actor: User,
    id: number,
    postIncome = true,
  ): Promise<void> {
    await this.prisma.db.transaction(async (tx) => {
      const invoice = await tx.orm.public.SalesDocument.where({ id })
        .forUpdate()
        .first();
      if (!invoice || invoice.type !== SalesDocTypeEnum.invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== SalesDocStatusEnum.draft) {
        throw new UnprocessableEntityException(
          `${invoice.number} is already ${invoice.status}.`,
        );
      }

      if (!postIncome) {
        await tx.orm.public.SalesDocument.where({ id }).update({
          status: SalesDocStatusEnum.issued,
        });
        return;
      }

      // Income is what the customer is charged before VAT: the subtotal less any discount.
      const subtotalUsd = this.money.toUsd(
        new Decimal(invoice.subtotal).minus(invoice.discountAmount).toFixed(4),
        invoice.exchangeRate,
      );
      // VAT takes the rounding remainder so the entry balances to the stored total.
      const vatUsd = this.money.round(
        new Decimal(invoice.totalUsd).minus(subtotalUsd),
      );
      const noDimensions = { departmentId: null, projectId: null };

      const entryId = await this.journal.post(
        tx,
        {
          entryDate: invoice.issueDate,
          memo: `Invoice ${invoice.number}`,
          currency: invoice.currency as CurrencyEnum,
          exchangeRate: invoice.exchangeRate,
          source: JournalSourceEnum.sales_invoice,
          sourceRef: invoice.id,
          createdById: Number(actor.id),
        },
        [
          {
            accountId: await this.account(tx, ACCOUNTS.receivable),
            debitUsd: invoice.totalUsd,
            creditUsd: '0',
            ...noDimensions,
          },
          {
            accountId: await this.account(tx, ACCOUNTS.income),
            debitUsd: '0',
            creditUsd: subtotalUsd,
            ...noDimensions,
          },
          ...(this.money.isPositive(vatUsd)
            ? [
                {
                  accountId: await this.account(tx, ACCOUNTS.vatPayable),
                  debitUsd: '0',
                  creditUsd: vatUsd,
                  ...noDimensions,
                },
              ]
            : []),
        ],
      );

      await tx.orm.public.SalesDocument.where({ id }).update({
        status: SalesDocStatusEnum.issued,
        journalEntryId: entryId,
      });
    });

    await this.log(
      actor,
      id,
      'issued',
      postIncome ? undefined : { ledger: 'skipped' },
    );
  }

  /**
   * Issued invoice → receipt for the full amount, invoice → paid. DR 1000 cash / CR 1100.
   * shortcut: one receipt pays the whole invoice at the invoice's USD value (no partial
   * payments, no FX gain/loss); add both if customers start paying in instalments.
   */
  async recordReceipt(
    actor: User,
    invoiceId: number,
    dto: RecordReceiptDto,
  ): Promise<number> {
    let number = '';

    const id = await this.prisma.db.transaction(async (tx) => {
      const invoice = await tx.orm.public.SalesDocument.where({ id: invoiceId })
        .forUpdate()
        .first();
      if (!invoice || invoice.type !== SalesDocTypeEnum.invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== SalesDocStatusEnum.issued) {
        throw new UnprocessableEntityException(
          invoice.status === SalesDocStatusEnum.paid
            ? `${invoice.number} is already paid.`
            : `${invoice.number} is ${invoice.status}; issue it before recording payment.`,
        );
      }

      // After the checks above, so a refused attempt never burns a number.
      number = await this.nextNumber(SalesDocTypeEnum.receipt);

      const receipt = await tx.orm.public.SalesDocument.create({
        type: SalesDocTypeEnum.receipt,
        number,
        status: SalesDocStatusEnum.issued,
        customerId: invoice.customerId,
        sourceId: invoice.id,
        issueDate: dto.paidOn,
        currency: invoice.currency,
        exchangeRate: rate(invoice.exchangeRate),
        language: invoice.language,
        discountType: invoice.discountType,
        discountValue: money(invoice.discountValue),
        discountAmount: money(invoice.discountAmount),
        vatRate: money(invoice.vatRate),
        subtotal: money(invoice.subtotal),
        vatAmount: money(invoice.vatAmount),
        total: money(invoice.total),
        totalUsd: money(invoice.totalUsd),
        paymentMethod: dto.paymentMethod,
        paymentReference: dto.paymentReference?.trim() || null,
        createdById: Number(actor.id),
      });

      const noDimensions = { departmentId: null, projectId: null };
      const entryId =
        invoice.journalEntryId === null
          ? null
          : await this.journal.post(
              tx,
              {
                entryDate: dto.paidOn,
                memo: `Receipt ${number} for ${invoice.number}`,
                currency: invoice.currency as CurrencyEnum,
                exchangeRate: invoice.exchangeRate,
                source: JournalSourceEnum.sales_receipt,
                sourceRef: receipt.id,
                createdById: Number(actor.id),
              },
              [
                {
                  accountId: await this.account(tx, ACCOUNTS.cash),
                  debitUsd: invoice.totalUsd,
                  creditUsd: '0',
                  ...noDimensions,
                },
                {
                  accountId: await this.account(tx, ACCOUNTS.receivable),
                  debitUsd: '0',
                  creditUsd: invoice.totalUsd,
                  ...noDimensions,
                },
              ],
            );

      if (entryId !== null) {
        await tx.orm.public.SalesDocument.where({ id: receipt.id }).update({
          journalEntryId: entryId,
        });
      }
      await tx.orm.public.SalesDocument.where({ id: invoice.id }).update({
        status: SalesDocStatusEnum.paid,
      });

      return receipt.id;
    });

    await this.log(actor, id, 'created', { number });
    await this.log(actor, invoiceId, 'paid', { receipt: number });
    return id;
  }

  /**
   * The company logo as a data URI, so the PDF (rendered from a string, with no base URL)
   * and the preview both carry it. Drop the file in public/images/ as company-logo.png,
   * .svg, .jpg or .jpeg; without one the documents print the company name instead.
   */
  async logoDataUri(): Promise<string | null> {
    const types = {
      png: 'image/png',
      svg: 'image/svg+xml',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    } as const;

    for (const [extension, mime] of Object.entries(types)) {
      try {
        const file = await readFile(
          join(process.cwd(), 'public', 'images', `company-logo.${extension}`),
        );
        return `data:${mime};base64,${file.toString('base64')}`;
      } catch {
        // Not this extension; try the next.
      }
    }
    return null;
  }

  /** Today's rate for the preview; null when none is on file (the form's save will refuse). */
  previewRate(currency: CurrencyEnum): Promise<string | null> {
    return this.rates.getCurrentRate(currency);
  }

  /** KHR per USD on the document's date, for the KHR total line GDT invoices carry. */
  async khrRateOn(date: string): Promise<string | null> {
    return this.rates.rateOn(CurrencyEnum.KHR, date);
  }

  private log(
    actor: User,
    id: number,
    action: string,
    detail?: Record<string, unknown>,
  ) {
    return this.activity.log({
      entityType: 'sales_document',
      entityId: id,
      action,
      actorId: Number(actor.id),
      detail,
    });
  }
}
