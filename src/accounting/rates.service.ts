import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ExchangeRateEntity } from './entities/exchange-rate.entity';
import { CurrencyEnum, RateSourceEnum } from '../common/enums';
import { ExchangeRateDto } from './dto/exchange-rate.dto';

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    @InjectRepository(ExchangeRateEntity)
    private readonly repository: Repository<ExchangeRateEntity>,
  ) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * The most recent rate on or before today, as units per 1 USD. USD is always 1. Returns
   * null when a foreign currency has no rate at all — callers must refuse to lock a record
   * to a rate that does not exist rather than silently using 1.
   */
  async getCurrentRate(currency: CurrencyEnum): Promise<string | null> {
    if (currency === CurrencyEnum.USD) return '1.000000';

    const row = await this.repository.findOne({
      where: { currency, rateDate: LessThanOrEqual(this.today()) },
      order: { rateDate: 'DESC' },
    });

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
  history(limit = 60): Promise<ExchangeRateEntity[]> {
    return this.repository.find({
      order: { rateDate: 'DESC', currency: 'ASC' },
      take: limit,
    });
  }

  /**
   * Finance/admin override for a given day. Upserts, because there is one row per
   * (date, currency) and correcting today's rate is the whole point.
   */
  async setManualRate(dto: ExchangeRateDto): Promise<void> {
    const existing = await this.repository.findOne({
      where: { rateDate: dto.rateDate, currency: dto.currency },
    });

    if (existing) {
      await this.repository.update(existing.id, {
        rateToUsd: String(dto.rateToUsd),
        source: RateSourceEnum.manual,
      });
      return;
    }

    await this.repository.save(
      this.repository.create({
        rateDate: dto.rateDate,
        currency: dto.currency,
        rateToUsd: String(dto.rateToUsd),
        source: RateSourceEnum.manual,
      }),
    );
  }

  /**
   * Daily fetch. A manual rate already set for today is never overwritten — finance's
   * correction outranks the feed. Failures are logged, never thrown: a missing rate simply
   * means new records in that currency are refused until someone sets one.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async fetchDailyRates(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD');
      const payload = (await response.json()) as {
        result?: string;
        rates?: Record<string, number>;
      };

      if (payload.result !== 'success' || !payload.rates) {
        throw new Error('rate feed returned no rates');
      }

      for (const currency of Object.values(CurrencyEnum)) {
        if (currency === CurrencyEnum.USD) continue;

        const rate = payload.rates[currency];
        if (!rate) continue;

        const existing = await this.repository.findOne({
          where: { rateDate: today, currency },
        });

        if (existing?.source === RateSourceEnum.manual) continue;

        if (existing) {
          await this.repository.update(existing.id, {
            rateToUsd: String(rate),
            source: RateSourceEnum.api,
          });
        } else {
          await this.repository.save(
            this.repository.create({
              rateDate: today,
              currency,
              rateToUsd: String(rate),
              source: RateSourceEnum.api,
            }),
          );
        }
      }

      this.logger.log(`Exchange rates updated for ${today}`);
    } catch (error) {
      this.logger.error(`Daily exchange rate fetch failed: ${error}`);
    }
  }
}
