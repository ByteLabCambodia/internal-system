import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { AuthModule } from './auth/auth.module';
import databaseConfig from './database/config/database.config';
import authConfig from './auth/config/auth.config';
import appConfig from './config/app.config';
import mailConfig from './mail/config/mail.config';
import fileConfig from './files/config/file.config';
import ocrConfig from './procurement/config/ocr.config';
import telegramConfig from './telegram/config/telegram.config';
import path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { MailModule } from './mail/mail.module';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AllConfigType } from './config/config.type';
import { SessionModule } from './session/session.module';
import { MailerModule } from './mailer/mailer.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PermissionsModule } from './permissions/permissions.module';
import { WebModule } from './common/web/web.module';
import { AuthWebModule } from './auth/web/auth-web.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MoneyModule } from './common/money/money.module';
import { ActivityModule } from './activity/activity.module';
import { AccountingModule } from './accounting/accounting.module';
import { OrgModule } from './org/org.module';
import { StorageModule } from './storage/storage.module';
import { ProcurementModule } from './procurement/procurement.module';
import { InventoryModule } from './inventory/inventory.module';
import { StockModule } from './stock/stock.module';
import { TelegramModule } from './telegram/telegram.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MiniAppModule } from './miniapp/miniapp.module';
import { ProfileModule } from './profile/profile.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';

const infrastructureDatabaseModule = TypeOrmModule.forRootAsync({
  useClass: TypeOrmConfigService,
  dataSourceFactory: async (options: DataSourceOptions) => {
    return new DataSource(options).initialize();
  },
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        appConfig,
        mailConfig,
        fileConfig,
        ocrConfig,
        telegramConfig,
      ],
      envFilePath: ['.env'],
    }),
    infrastructureDatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // Daily exchange-rate fetch lives here (RatesService.fetchDailyRates).
    ScheduleModule.forRoot(),
    I18nModule.forRootAsync({
      useFactory: (configService: ConfigService<AllConfigType>) => ({
        fallbackLanguage: configService.getOrThrow('app.fallbackLanguage', {
          infer: true,
        }),
        loaderOptions: { path: path.join(__dirname, '/i18n/'), watch: true },
      }),
      resolvers: [
        {
          use: HeaderResolver,
          useFactory: (configService: ConfigService<AllConfigType>) => {
            return [
              configService.get('app.headerLanguage', {
                infer: true,
              }),
            ];
          },
          inject: [ConfigService],
        },
      ],
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
    UsersModule,
    FilesModule,
    AuthModule,
    SessionModule,
    MailModule,
    MailerModule,
    // Operations system: permission matrix, the page layer, and the web auth pages.
    PermissionsModule,
    WebModule,
    AuthWebModule,
    DashboardModule,
    MoneyModule,
    ActivityModule,
    AccountingModule,
    OrgModule,
    StorageModule,
    ProcurementModule,
    InventoryModule,
    StockModule,
    TelegramModule,
    NotificationsModule,
    MiniAppModule,
    ProfileModule,
    SettingsModule,
    AdminModule,
  ],
})
export class AppModule {}
