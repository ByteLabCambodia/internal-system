import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import crypto from 'crypto';
import {
  AuthTokenEntity,
  AuthTokenPurposeEnum,
} from './entities/auth-token.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';

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
  constructor(
    @InjectRepository(AuthTokenEntity)
    private readonly repository: Repository<AuthTokenEntity>,
  ) {}

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
    const user = new UserEntity();
    user.id = userId;

    await this.repository.save(
      this.repository.create({
        user,
        tokenHash: this.hash(token),
        purpose,
        expiresAt,
      }),
    );

    return { token, expiresAt };
  }

  /** Marks the token used and returns its owner. Never returns a user for a stale token. */
  async consume(
    token: string,
    purpose: AuthTokenPurposeEnum,
  ): Promise<ConsumeResult> {
    const row = await this.repository.findOne({
      where: { tokenHash: this.hash(token), purpose },
      relations: ['user'],
    });

    if (!row) return { ok: false, reason: 'unknown' };
    if (row.usedAt) return { ok: false, reason: 'used' };
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    await this.repository.update(row.id, { usedAt: new Date() });

    return { ok: true, userId: row.user.id };
  }

  /** Verify without consuming — used to render the set/reset password form. */
  async peek(
    token: string,
    purpose: AuthTokenPurposeEnum,
  ): Promise<ConsumeResult> {
    const row = await this.repository.findOne({
      where: { tokenHash: this.hash(token), purpose },
      relations: ['user'],
    });

    if (!row) return { ok: false, reason: 'unknown' };
    if (row.usedAt) return { ok: false, reason: 'used' };
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, userId: row.user.id };
  }

  async invalidateAll(
    userId: number,
    purpose: AuthTokenPurposeEnum,
  ): Promise<void> {
    await this.repository.delete({ user: { id: userId }, purpose });
  }

  async hasPendingInvite(userId: number): Promise<boolean> {
    const count = await this.repository.count({
      where: {
        user: { id: userId },
        purpose: AuthTokenPurposeEnum.invite,
        usedAt: IsNull(),
      },
    });

    return count > 0;
  }

  /** Housekeeping: drop tokens that expired more than a day ago. */
  async pruneExpired(): Promise<void> {
    await this.repository.delete({
      expiresAt: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    });
  }
}
