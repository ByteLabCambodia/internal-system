import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { AppSettingEntity } from './entities/app-setting.entity';

/**
 * Key/value settings, including the C3 tolerances (`payment_tolerance_pct`,
 * `receipt_tolerance_pct`) the payment and claim workflows read.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSettingEntity)
    private readonly repository: Repository<AppSettingEntity>,
  ) {}

  findAll(): Promise<AppSettingEntity[]> {
    return this.repository.find({ order: { key: 'ASC' } });
  }

  async get(key: string, fallback = ''): Promise<string> {
    const row = await this.repository.findOne({ where: { key } });
    return row?.value ?? fallback;
  }

  /** A numeric setting. Missing, blank or unparseable values fall back rather than throw. */
  async numeric(key: string, fallback: Decimal.Value = 0): Promise<Decimal> {
    const value = (await this.get(key)).trim();
    if (!value) return new Decimal(fallback);

    try {
      return new Decimal(value);
    } catch {
      return new Decimal(fallback);
    }
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.repository.findOne({ where: { key } });

    if (existing) {
      await this.repository.update({ key }, { value });
      return;
    }

    await this.repository.save(this.repository.create({ key, value }));
  }
}
