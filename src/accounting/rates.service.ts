import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyEnum, RateSourceEnum } from '../common/enums';
import { rate } from '../prisma/numeric';
import { ExchangeRateDto } from './dto/exchange-rate.dto';

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  private get rates() {
    return this.prisma.db.orm.public.ExchangeRate;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * The most recent rate on or before today, as units per 1 USD. USD is always 1. Returns
   * null when a foreign currency has no rate at all — callers must refuse to lock a record
   * to a rate that does not exist rather than silently using 1.
   */
  async getCurrentRate(currency: `${CurrencyEnum}`): Promise<string | null> {
    if (currency === CurrencyEnum.USD) return '1.000000';

    const row = await this.rates
      .where({ currency })
      .where((r) => r.rateDate.lte(this.today()))
      .orderBy((r) => r.rateDate.desc())
      .first();

    return row?.rateToUsd ?? null;
  }

  /** Every currency's current rate, for form previews. */
  async currentRates(): Promise<Record<string, string | null>> {
    const entries = await Promise.all(
      Object.values(CurrencyEnum).map(
        async (currency) =>
          [currency, await this.getCurrentRate(currency)] as const,
      ),
    );

    return Object.fromEntries(entries);
  }

  /** Recent rates for the accounting screen. */
  async history(limit = 60) {
    return await this.rates
      .orderBy([(r) => r.rateDate.desc(), (r) => r.currency.asc()])
      .limit(limit)
      .all();
  }

  /**
   * Finance/admin override for a given day. Upserts, because there is one row per
   * (date, currency) and correcting today's rate is the whole point.
   */
  async setManualRate(dto: ExchangeRateDto): Promise<void> {
    const rateToUsd = rate(String(dto.rateToUsd));

    await this.rates.upsert({
      create: {
        rateDate: dto.rateDate,
        currency: dto.currency,
        rateToUsd,
        source: RateSourceEnum.manual,
      },
      update: { rateToUsd, source: RateSourceEnum.manual },
      conflictOn: { rateDate: dto.rateDate, currency: dto.currency },
    });
  }
}
