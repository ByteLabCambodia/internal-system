import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { nullableMoney } from '../prisma/numeric';
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
  constructor(private readonly prisma: PrismaService) {}

  private get thresholds() {
    return this.prisma.db.orm.public.ApprovalThreshold;
  }

  /** With `role` loaded: Admin → Settings matches rows by `threshold.role.id`. */
  async findAll() {
    return await this.thresholds
      .include('role')
      .orderBy((t) => t.id.asc())
      .all();
  }

  async check(roleId: number, totalUsd: string): Promise<ThresholdCheck> {
    const row = await this.thresholds.where({ roleId, active: true }).first();

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
    const rows = await this.thresholds.where({ active: true }).all();
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

    return RoleEnum[sufficient[0].roleId] ?? null;
  }

  /** No row at all means the role cannot approve any amount. */
  async removeLimit(roleId: number): Promise<void> {
    await this.thresholds.where({ roleId }).deleteAll();
  }

  async setLimit(roleId: number, maxAmountUsd: string | null): Promise<void> {
    const limit = nullableMoney(maxAmountUsd);
    await this.thresholds.upsert({
      create: { roleId, maxAmountUsd: limit },
      update: { maxAmountUsd: limit },
      conflictOn: { roleId },
    });
  }
}
