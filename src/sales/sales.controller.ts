import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  CurrencyEnum,
  DiscountTypeEnum,
  PaymentMethodEnum,
  SalesDocLanguageEnum,
  SalesDocStatusEnum,
  SalesDocTypeEnum,
} from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { ActivityService } from '../activity/activity.service';
import { CustomersService } from '../org/customers.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { csvResponse } from '../common/web/csv';
import { buildBaseQuery } from '../procurement/purchase-requests.controller';
import { RecordReceiptDto, SalesDocumentDto } from './dto/sales-document.dto';
import { SalesService } from './sales.service';
import { PdfService } from './pdf.service';

const TITLES: Record<SalesDocTypeEnum, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

const addDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Quotation → invoice → receipt, their CSV export and their A4 PDFs. */
@RequirePermission(PermissionEnum['sales.manage'])
@Controller('sales')
export class SalesController {
  constructor(
    private readonly service: SalesService,
    private readonly pdf: PdfService,
    private readonly customers: CustomersService,
    private readonly activity: ActivityService,
    private readonly money: MoneyService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    const type = query.type as SalesDocTypeEnum | undefined;
    const status = query.status as SalesDocStatusEnum | undefined;
    return {
      type: type && type in TITLES ? type : undefined,
      status:
        status && Object.values(SalesDocStatusEnum).includes(status)
          ? status
          : undefined,
      search: query.search || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      page: Math.max(1, Number(query.page) || 1),
      limit: 20,
    };
  }

  @Get()
  async list(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = this.parseFilters(query);
    const { rows, count } = await this.service.list(filters);

    return response.render('sales/list', {
      title: 'Sales',
      primaryAction: { href: '/sales/new', label: 'New quotation' },
      rows,
      count,
      filters,
      types: Object.values(SalesDocTypeEnum),
      statuses: Object.values(SalesDocStatusEnum),
      money: this.money,
      baseQuery: buildBaseQuery(query, ['page']),
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = { ...this.parseFilters(query), page: 1, limit: 10_000 };
    const { rows } = await this.service.list(filters);

    return csvResponse(
      response,
      'sales-documents.csv',
      [
        'Number',
        'Type',
        'Status',
        'Date',
        'Customer',
        'From',
        'Currency',
        'Rate',
        'Subtotal',
        'VAT',
        'Total',
        'Total USD',
        'Due date',
        'Payment method',
        'Payment reference',
      ],
      rows.map((row) => [
        row.number,
        row.type,
        row.status,
        row.issueDate,
        row.customer.name,
        row.source?.number ?? '',
        row.currency,
        row.exchangeRate,
        row.subtotal,
        row.vatAmount,
        row.total,
        row.totalUsd,
        row.dueDate ?? '',
        row.paymentMethod ?? '',
        row.paymentReference ?? '',
      ]),
    );
  }

  /**
   * The form's live preview: the same template the PDF uses, filled from what is typed so
   * far. Lenient on purpose: a half-filled form still previews, it just shows blanks.
   */
  @Post('preview')
  async preview(@Body() body: Record<string, any>, @Res() response: Response) {
    try {
      const items = (Array.isArray(body.items) ? body.items : []).map(
        (item: Record<string, string>) => ({
          description: item?.description ?? '',
          detail: item?.detail || null,
          qty: Number(item?.qty) || 0,
          unitPrice: Number(item?.unitPrice) || 0,
        }),
      );
      const vatRate = Number(body.vatRate) || 0;
      const totals = this.service.totals(items, vatRate, {
        type:
          body.discountType === DiscountTypeEnum.amount
            ? DiscountTypeEnum.amount
            : DiscountTypeEnum.percent,
        value: Number(body.discountValue) || 0,
      });
      const customer = (await this.customers.findActive()).find(
        (c) => String(c.id) === String(body.customerId),
      );
      const currency = Object.values(CurrencyEnum).includes(body.currency)
        ? (body.currency as CurrencyEnum)
        : CurrencyEnum.USD;
      const editingId = Number(body.editingId) || null;
      const existing = editingId ? await this.service.findOne(editingId) : null;
      const type =
        body.type === SalesDocTypeEnum.invoice
          ? SalesDocTypeEnum.invoice
          : SalesDocTypeEnum.quotation;

      const doc = {
        number:
          existing?.number ?? (type === 'invoice' ? 'INV-0000' : 'QT-0000'),
        type,
        status: 'draft',
        customer: customer ?? {
          name: '—',
          address: null,
        },
        source: existing?.source ?? null,
        items: items.map(
          (item: { qty: number; unitPrice: number }, index: number) => ({
            ...item,
            amount: totals.lines[index],
          }),
        ),
        language: Object.values(SalesDocLanguageEnum).includes(body.language)
          ? body.language
          : SalesDocLanguageEnum.both,
        currency,
        exchangeRate: (await this.service.previewRate(currency)) ?? '1',
        vatRate,
        discountType: body.discountType,
        discountValue: Number(body.discountValue) || 0,
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        issueDate: body.issueDate || addDays(0),
        dueDate: type === 'invoice' ? body.dueDate || null : null,
        notes: body.notes || null,
        paymentMethod: null,
        paymentReference: null,
      };

      response.type('html').send(await this.renderPrint(response, doc, true));
    } catch (error) {
      response
        .type('html')
        .send(
          `<p style="font:14px sans-serif;padding:16px">Preview unavailable: ${(error as Error).message}</p>`,
        );
    }
  }

  private async renderForm(
    response: Response,
    values: Record<string, unknown>,
    options: {
      editing?: { id: number; number: string } | null;
      errors?: Record<string, string>;
      alert?: string;
      status?: number;
    } = {},
  ) {
    const type =
      values.type === SalesDocTypeEnum.invoice ? 'invoice' : 'quotation';
    return response.status(options.status ?? 200).render('sales/form', {
      title: options.editing ? `Edit ${options.editing.number}` : `New ${type}`,
      customers: await this.customers.findActive(),
      currencies: Object.values(CurrencyEnum),
      languages: Object.values(SalesDocLanguageEnum),
      values,
      errors: options.errors ?? {},
      alert: options.alert,
      editing: options.editing ?? null,
    });
  }

  @Get('new')
  async newForm(@Res() response: Response, @Query('type') type?: string) {
    const company = await this.service.company();
    return this.renderForm(response, {
      type:
        type === SalesDocTypeEnum.invoice ? type : SalesDocTypeEnum.quotation,
      issueDate: addDays(0),
      dueDate: addDays(30),
      currency: CurrencyEnum.USD,
      vatRate: company.sales_vat_rate || '0',
      language: company.sales_default_language || SalesDocLanguageEnum.both,
      discountType: DiscountTypeEnum.percent,
      discountValue: 0,
      items: [{ description: '', detail: '', qty: 1, unitPrice: 0 }],
    });
  }

  @Post()
  async create(@Body() body: SalesDocumentDto, @Res() response: Response) {
    const form = await validateForm(SalesDocumentDto, body);
    if (!form.ok) {
      return this.renderForm(response, body as never, {
        errors: form.errors,
        status: 422,
      });
    }

    try {
      const id = await this.service.create(
        response.locals.currentUser,
        form.data,
      );
      setFlash(
        response,
        'success',
        `${TITLES[form.data.type]} created as a draft.`,
      );
      return response.redirect(`/sales/${id}`);
    } catch (error) {
      return this.renderForm(response, body as never, {
        alert: (error as Error).message,
        status: 422,
      });
    }
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const doc = await this.service.findOne(id);

    return response.render('sales/detail', {
      title: doc.number,
      doc,
      typeTitle: TITLES[doc.type as SalesDocTypeEnum],
      transitions: this.service.allowedTransitions(doc),
      paymentMethods: Object.values(PaymentMethodEnum),
      today: addDays(0),
      money: this.money,
      events: await this.activity.timelineFor('sales_document', id),
    });
  }

  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const doc = await this.service.findOne(id);
    if (
      doc.status !== SalesDocStatusEnum.draft ||
      doc.type === SalesDocTypeEnum.receipt
    ) {
      setFlash(
        response,
        'error',
        `${doc.number} is ${doc.status}; only drafts can be edited.`,
      );
      return response.redirect(`/sales/${id}`);
    }

    return this.renderForm(
      response,
      {
        ...doc,
        vatRate: Number(doc.vatRate),
        discountValue: Number(doc.discountValue),
        items: doc.items.map((item) => ({
          description: item.description,
          detail: item.detail ?? '',
          qty: Number(item.qty),
          unitPrice: Number(item.unitPrice),
        })),
      },
      { editing: { id, number: doc.number } },
    );
  }

  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesDocumentDto,
    @Res() response: Response,
  ) {
    const doc = await this.service.findOne(id);
    const values = { ...body, type: doc.type };
    const form = await validateForm(SalesDocumentDto, values);
    const editing = { id, number: doc.number };

    if (!form.ok) {
      return this.renderForm(response, values as never, {
        editing,
        errors: form.errors,
        status: 422,
      });
    }

    try {
      await this.service.update(response.locals.currentUser, id, form.data);
      setFlash(response, 'success', `${doc.number} saved.`);
      return response.redirect(`/sales/${id}`);
    } catch (error) {
      return this.renderForm(response, values as never, {
        editing,
        alert: (error as Error).message,
        status: 422,
      });
    }
  }

  /** Runs one workflow step and comes back to the document with its outcome. */
  private async step(
    response: Response,
    id: number,
    run: () => Promise<string | number>,
    success: string,
  ) {
    try {
      const result = await run();
      setFlash(response, 'success', success);
      return response.redirect(
        `/sales/${typeof result === 'number' ? result : id}`,
      );
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
      return response.redirect(`/sales/${id}`);
    }
  }

  @Post(':id/status')
  status(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: SalesDocStatusEnum,
    @Res() response: Response,
  ) {
    return this.step(
      response,
      id,
      async () => {
        await this.service.setStatus(response.locals.currentUser, id, status);
        return '';
      },
      `Marked as ${status}.`,
    );
  }

  @Post(':id/language')
  language(
    @Param('id', ParseIntPipe) id: number,
    @Body('language') language: SalesDocLanguageEnum,
    @Res() response: Response,
  ) {
    return this.step(
      response,
      id,
      async () => {
        await this.service.setLanguage(
          response.locals.currentUser,
          id,
          language,
        );
        return '';
      },
      'Document language changed.',
    );
  }

  @Post(':id/convert')
  convert(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    return this.step(
      response,
      id,
      () => this.service.convertToInvoice(response.locals.currentUser, id),
      'Invoice created from the quotation. Check it, then issue it.',
    );
  }

  @Post(':id/issue')
  issue(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { postIncome?: string },
    @Res() response: Response,
  ) {
    const postIncome = body.postIncome === 'on';
    return this.step(
      response,
      id,
      async () => {
        await this.service.issueInvoice(
          response.locals.currentUser,
          id,
          postIncome,
        );
        return '';
      },
      postIncome
        ? 'Invoice issued and posted to the ledger.'
        : 'Invoice issued. Nothing was posted to the ledger.',
    );
  }

  @Post(':id/receipt')
  async receipt(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RecordReceiptDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(RecordReceiptDto, body);
    if (!form.ok) {
      setFlash(response, 'error', Object.values(form.errors)[0]);
      return response.redirect(`/sales/${id}`);
    }

    return this.step(
      response,
      id,
      () =>
        this.service.recordReceipt(response.locals.currentUser, id, form.data),
      'Payment recorded and receipt created.',
    );
  }

  private async renderPrint(
    response: Response,
    doc: Record<string, any>,
    preview: boolean,
  ): Promise<string> {
    const locals = {
      layout: false,
      doc,
      preview,
      logo: await this.service.logoDataUri(),
      company: await this.service.company(),
      khrRate:
        doc.currency === CurrencyEnum.KHR
          ? null
          : await this.service.khrRateOn(doc.issueDate),
      money: this.money,
    };

    return await new Promise<string>((resolve, reject) =>
      response.render('sales/print', locals, (error, out) =>
        error ? reject(error) : resolve(out),
      ),
    );
  }

  private async printHtml(
    response: Response,
    id: number,
    preview = false,
  ): Promise<{ html: string; number: string }> {
    const doc = await this.service.findOne(id);
    return {
      html: await this.renderPrint(response, doc, preview),
      number: doc.number,
    };
  }

  /** The PDF's HTML in the browser, for checking a layout without downloading. */
  @Get(':id/print')
  async print(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
    @Query('preview') preview?: string,
  ) {
    const { html } = await this.printHtml(response, id, preview === '1');
    // Not returned: res.send() hands back the response, which Nest would try to serialise.
    response.type('html').send(html);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const { html, number } = await this.printHtml(response, id);
    const pdf = await this.pdf.fromHtml(html);

    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${number}.pdf"`)
      .send(pdf);
  }
}
