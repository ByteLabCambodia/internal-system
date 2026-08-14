import { NestFactory } from '@nestjs/core';
import { SeedModule } from './seed.module';
import { RoleSeedService } from './role/role-seed.service';
import { UserSeedService } from './user/user-seed.service';
import { AccountSeedService } from './account/account-seed.service';
import { CategorySeedService } from './category/category-seed.service';
import { ApprovalThresholdSeedService } from './approval-threshold/approval-threshold-seed.service';
import { AppSettingSeedService } from './app-setting/app-setting-seed.service';

const runSeed = async () => {
  const app = await NestFactory.create(SeedModule);

  // run — roles and accounts first, everything else references them
  await app.get(RoleSeedService).run();
  await app.get(AccountSeedService).run();
  await app.get(CategorySeedService).run();
  await app.get(ApprovalThresholdSeedService).run();
  await app.get(AppSettingSeedService).run();
  await app.get(UserSeedService).run();

  await app.close();
};

void runSeed();
