import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalThresholdEntity } from '../../../../org/entities/approval-threshold.entity';
import { RoleEntity } from '../../../../roles/infrastructure/persistence/relational/entities/role.entity';
import { RoleEnum } from '../../../../roles/roles.enum';

// C2: a manager may approve up to $1,000; an admin is unlimited (null).
const THRESHOLDS: { roleId: number; maxAmountUsd: string | null }[] = [
  { roleId: RoleEnum.manager, maxAmountUsd: '1000.0000' },
  { roleId: RoleEnum.admin, maxAmountUsd: null },
];

@Injectable()
export class ApprovalThresholdSeedService {
  constructor(
    @InjectRepository(ApprovalThresholdEntity)
    private readonly repository: Repository<ApprovalThresholdEntity>,
  ) {}

  async run() {
    for (const threshold of THRESHOLDS) {
      const existing = await this.repository.findOne({
        where: { role: { id: threshold.roleId } },
      });

      if (!existing) {
        const role = new RoleEntity();
        role.id = threshold.roleId;

        await this.repository.save(
          this.repository.create({
            role,
            maxAmountUsd: threshold.maxAmountUsd,
          }),
        );
      }
    }
  }
}
