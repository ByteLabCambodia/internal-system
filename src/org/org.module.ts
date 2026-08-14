import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentEntity } from './entities/department.entity';
import { ProjectEntity } from './entities/project.entity';
import { SupplierEntity } from './entities/supplier.entity';
import { ApprovalThresholdEntity } from './entities/approval-threshold.entity';
import { OrgService } from './org.service';
import { SuppliersService } from './suppliers.service';
import { ApprovalThresholdsService } from './approval-thresholds.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DepartmentEntity,
      ProjectEntity,
      SupplierEntity,
      ApprovalThresholdEntity,
    ]),
  ],
  controllers: [SuppliersController],
  providers: [OrgService, SuppliersService, ApprovalThresholdsService],
  exports: [OrgService, SuppliersService, ApprovalThresholdsService],
})
export class OrgModule {}
