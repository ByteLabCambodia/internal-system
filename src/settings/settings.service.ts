import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from './entities/app-setting.entity';

/**
 * Key/value settings, including the two the C3 triggers read directly. Writes go through
 * here so the trigger and the UI can never disagree about where the value lives.
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

  async set(key: string, value: string): Promise<void> {
    const existing = await this.repository.findOne({ where: { key } });

    if (existing) {
      await this.repository.update({ key }, { value });
      return;
    }

    await this.repository.save(this.repository.create({ key, value }));
  }
}
