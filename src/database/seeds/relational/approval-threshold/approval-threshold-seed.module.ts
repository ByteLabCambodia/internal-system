import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApprovalThresholdSeedService } from './approval-threshold-seed.service';
import { ApprovalThresholdEntity } from '../../../../org/entities/approval-threshold.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalThresholdEntity])],
  providers: [ApprovalThresholdSeedService],
  exports: [ApprovalThresholdSeedService],
})
export class ApprovalThresholdSeedModule {}
