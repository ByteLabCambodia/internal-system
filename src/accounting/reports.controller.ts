import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { MoneyService } from '../common/money/money.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { csvResponse } from '../common/web/csv';

/** All nine reports share one page shell, one date filter and one CSV route. */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly money: MoneyService,
  ) {}

  private range(query: Record<string, string | undefined>) {
    return { from: query.from || undefined, to: query.to || undefined };
  }

  @RequirePermission(PermissionEnum['accounting.view'])
  @Get()
  index(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    return response.redirect(
      `/reports/profit-and-loss${query.from || query.to ? `?from=${query.from ?? ''}&to=${query.to ?? ''}` : ''}`,
    );
  }

  @RequirePermission(PermissionEnum['accounting.view'])
  @Get(':key/export.csv')
  async exportCsv(
    @Param('key') key: string,
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const report = await this.service.build(key, this.range(query));
    if (!report) throw new NotFoundException('Unknown report');

    return csvResponse(
      response,
      `${report.key}.csv`,
      report.columns.map((column) => column.label),
      report.rows.map((row) => report.columns.map((column) => row[column.key])),
    );
  }

  @RequirePermission(PermissionEnum['accounting.view'])
  @Get(':key')
  async show(
    @Param('key') key: string,
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const range = this.range(query);
    const report = await this.service.build(key, range);
    if (!report) throw new NotFoundException('Unknown report');

    return response.render('accounting/report', {
      title: report.title,
      report,
      reports: this.service.keys,
      range,
      money: this.money,
      query: new URLSearchParams({
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
      }).toString(),
    });
  }
}
