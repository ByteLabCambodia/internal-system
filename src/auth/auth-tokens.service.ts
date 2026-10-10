import { Injectable } from '@nestjs/common';
import crypto from 'crypto';
import { AuthTokenPurposeEnum } from './entities/auth-token.entity';
import { PrismaService } from '../prisma/prisma.service';
import { toDate } from '../prisma/dates';
import { timestamptz } from '../prisma/numeric';

/** Invites last 7 days, password resets 1 hour (Part 1 §2.10). Both are single-use. */
export const TOKEN_TTL_MS: Record<AuthTokenPurposeEnum, number> = {
  [AuthTokenPurposeEnum.invite]: 7 * 24 * 60 * 60 * 1000,
  [AuthTokenPurposeEnum.reset]: 60 * 60 * 1000,
};

export type ConsumeResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' };

@Injectable()
export class AuthTokensService {
  constructor(private readonly prisma: PrismaService) {}

  private get tokens() {
    return this.prisma.db.orm.public.AuthToken;
  }

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issues a token and returns the raw value — the only time it exists in plaintext.
   * Any earlier token for the same user and purpose is invalidated, so "resend invite"
   * really does kill the previous link.
   */
  async issue(
    userId: number,
    purpose: AuthTokenPurposeEnum,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.invalidateAll(userId, purpose);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]);

    await this.tokens.create({
      userId,
      tokenHash: this.hash(token),
      purpose,
      expiresAt: timestamptz(expiresAt),
    });

    return { token, expiresAt };
  }

  private async check(token: string, purpose: AuthTokenPurposeEnum) {
    const row = await this.tokens
      .where({ tokenHash: this.hash(token), purpose })
      .first();

    if (!row) return { result: { ok: false, reason: 'unknown' } as const };
    if (row.usedAt) return { result: { ok: false, reason: 'used' } as const };
    if (toDate(row.expiresAt).getTime() < Date.now()) {
      return { result: { ok: false, reason: 'expired' } as const };
    }
    return { row };
  }

  /** Marks the token used and returns its owner. Never returns a user for a stale token. */
  async consume(
    token: string,
    purpose: AuthTokenPurposeEnum,
  ): Promise<ConsumeResult> {
    const { row, result } = await this.check(token, purpose);
    if (!row) return result;

    // Only the first of two concurrent uses wins: the update requires usedAt still null.
    const claimed = await this.tokens
      .where({ id: row.id })
      .where((t) => t.usedAt.isNull())
      .update({ usedAt: timestamptz(new Date()) });

    return claimed
      ? { ok: true, userId: row.userId }
      : { ok: false, reason: 'used' };
  }

  /** Verify without consuming — used to render the set/reset password form. */
  async peek(
    token: string,
    purpose: AuthTokenPurposeEnum,
  ): Promise<ConsumeResult> {
    const { row, result } = await this.check(token, purpose);
    return row ? { ok: true, userId: row.userId } : result;
  }

  async invalidateAll(
    userId: number,
    purpose: AuthTokenPurposeEnum,
  ): Promise<void> {
    await this.tokens.where({ userId, purpose }).deleteAll();
  }

  async hasPendingInvite(userId: number): Promise<boolean> {
    const pending = await this.tokens
      .where({ userId, purpose: AuthTokenPurposeEnum.invite })
      .where((t) => t.usedAt.isNull())
      .first();

    return pending !== null;
  }

  /** Housekeeping: drop tokens that expired more than a day ago. */
  async pruneExpired(): Promise<void> {
    const cutoff = timestamptz(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await this.tokens.where((t) => t.expiresAt.lt(cutoff)).deleteAll();
  }
}
