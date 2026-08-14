import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../../../../settings/entities/app-setting.entity';

// C3 tolerances live in the DB because the guards are triggers and a trigger cannot read
// the app's config. Both default to 0 — real purchasing sometimes wants 2–5%.
const SETTINGS: { key: string; value: string; description: string }[] = [
  {
    key: 'receipt_tolerance_pct',
    value: '0',
    description:
      'Fraction over qty_ordered a claim may receive, e.g. 0.05 for 5%. 0 = exact.',
  },
  {
    key: 'payment_tolerance_pct',
    value: '0',
    description:
      'Fraction over the PO total_usd that payments may sum to, e.g. 0.02 for 2%. 0 = exact.',
  },
];

@Injectable()
export class AppSettingSeedService {
  constructor(
    @InjectRepository(AppSettingEntity)
    private readonly repository: Repository<AppSettingEntity>,
  ) {}

  async run() {
    for (const setting of SETTINGS) {
      const existing = await this.repository.findOne({
        where: { key: setting.key },
      });

      if (!existing) {
        await this.repository.save(this.repository.create(setting));
      }
    }
  }
}
