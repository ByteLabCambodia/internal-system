import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { ApprovalThresholdEntity } from './entities/approval-threshold.entity';
import { RoleEnum } from '../roles/roles.enum';

export type ThresholdCheck =
  | { ok: true }
  | { ok: false; limit: string; requiredRole: string | null };

/**
 * C2 amount tiers. `pr.decide` gates who may attempt a decision; this gates which decisions
 * succeed. A role with no active row cannot approve any amount.
 */
@Injectable()
export class ApprovalThresholdsService {
  constructor(
    @InjectRepository(ApprovalThresholdEntity)
    private readonly repository: Repository<ApprovalThresholdEntity>,
  ) {}

  findAll(): Promise<ApprovalThresholdEntity[]> {
    return this.repository.find({ order: { id: 'ASC' } });
  }

  async check(roleId: number, totalUsd: string): Promise<ThresholdCheck> {
    const row = await this.repository.findOne({
      where: { role: { id: roleId }, active: true },
    });

    if (!row) {
      return {
        ok: false,
        limit: '0',
        requiredRole: await this.lowestSufficientRole(totalUsd),
      };
    }

    // null max_amount_usd means unlimited
    if (row.maxAmountUsd === null) return { ok: true };

    if (new Decimal(totalUsd).greaterThan(new Decimal(row.maxAmountUsd))) {
      return {
        ok: false,
        limit: row.maxAmountUsd,
        requiredRole: await this.lowestSufficientRole(totalUsd),
      };
    }

    return { ok: true };
  }

  /** Names the role the requester needs, so the error can say who to escalate to. */
  private async lowestSufficientRole(totalUsd: string): Promise<string | null> {
    const rows = await this.repository.find({ where: { active: true } });
    const amount = new Decimal(totalUsd);

    const sufficient = rows.filter(
      (row) =>
        row.maxAmountUsd === null ||
        new Decimal(row.maxAmountUsd).greaterThanOrEqualTo(amount),
    );

    if (!sufficient.length) return null;

    // prefer the tightest limit that still covers the amount
    sufficient.sort((a, b) => {
      if (a.maxAmountUsd === null) return 1;
      if (b.maxAmountUsd === null) return -1;
      return new Decimal(a.maxAmountUsd).comparedTo(
        new Decimal(b.maxAmountUsd),
      );
    });

    return RoleEnum[Number(sufficient[0].role.id)] ?? null;
  }

  /** No row at all means the role cannot approve any amount. */
  async removeLimit(roleId: number): Promise<void> {
    await this.repository.delete({ role: { id: roleId } });
  }

  async setLimit(roleId: number, maxAmountUsd: string | null): Promise<void> {
    const existing = await this.repository.findOne({
      where: { role: { id: roleId } },
    });

    if (existing) {
      await this.repository.update(existing.id, { maxAmountUsd });
      return;
    }

    await this.repository.save(
      this.repository.create({ role: { id: roleId } as never, maxAmountUsd }),
    );
  }
}
