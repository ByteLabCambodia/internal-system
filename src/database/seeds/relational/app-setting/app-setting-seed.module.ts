import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppSettingSeedService } from './app-setting-seed.service';
import { AppSettingEntity } from '../../../../settings/entities/app-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppSettingEntity])],
  providers: [AppSettingSeedService],
  exports: [AppSettingSeedService],
})
export class AppSettingSeedModule {}
