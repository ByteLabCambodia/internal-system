import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Key/value settings, including the C3 tolerances (`payment_tolerance_pct`,
 * `receipt_tolerance_pct`) the payment and claim workflows read.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private get settings() {
    return this.prisma.db.orm.public.AppSetting;
  }

  async findAll() {
    return await this.settings.orderBy((s) => s.key.asc()).all();
  }

  async get(key: string, fallback = ''): Promise<string> {
    const row = await this.settings.where({ key }).first();
    return row?.value ?? fallback;
  }

  async set(key: string, value: string): Promise<void> {
    await this.settings.upsert({
      create: { key, value },
      update: { value },
      conflictOn: { key },
    });
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
}
