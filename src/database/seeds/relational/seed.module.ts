import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataSource, DataSourceOptions } from 'typeorm';
import { TypeOrmConfigService } from '../../typeorm-config.service';
import { RoleSeedModule } from './role/role-seed.module';
import { UserSeedModule } from './user/user-seed.module';
import { AccountSeedModule } from './account/account-seed.module';
import { CategorySeedModule } from './category/category-seed.module';
import { ApprovalThresholdSeedModule } from './approval-threshold/approval-threshold-seed.module';
import { AppSettingSeedModule } from './app-setting/app-setting-seed.module';
import databaseConfig from '../../config/database.config';
import appConfig from '../../../config/app.config';

@Module({
  imports: [
    RoleSeedModule,
    UserSeedModule,
    AccountSeedModule,
    CategorySeedModule,
    ApprovalThresholdSeedModule,
    AppSettingSeedModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, appConfig],
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
      dataSourceFactory: async (options: DataSourceOptions) => {
        return new DataSource(options).initialize();
      },
    }),
  ],
})
export class SeedModule {}
