import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalThresholdEntity } from '../../../../org/entities/approval-threshold.entity';
import { RoleEntity } from '../../../../roles/infrastructure/persistence/relational/entities/role.entity';
import { RoleEnum } from '../../../../roles/roles.enum';

// Manager and admin are both unlimited (null) — no per-role approval cap.
const THRESHOLDS: { roleId: number; maxAmountUsd: string | null }[] = [
  { roleId: RoleEnum.manager, maxAmountUsd: null },
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
