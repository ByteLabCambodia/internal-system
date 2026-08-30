import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ExchangeRateEntity } from './entities/exchange-rate.entity';
import { CurrencyEnum, RateSourceEnum } from '../common/enums';
import { ExchangeRateDto } from './dto/exchange-rate.dto';

@Injectable()
export class RatesService {
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
}
