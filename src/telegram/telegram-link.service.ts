import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { toDate, toTimestamp } from '../prisma/dates';
import { timestamp } from '../prisma/numeric';
import { User } from '../users/domain/user';
import { UserMapper } from '../users/infrastructure/persistence/relational/mappers/user.mapper';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Two ways to link a Telegram account to a profile (Part 1 §2.8):
 *   - a one-time token generated on the profile page and sent to the bot, and
 *   - a credentials endpoint for the Mini App's "link account" screen.
 */
@Injectable()
export class TelegramLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live (not soft-deleted) users, as TypeORM's find returned. */
  private live() {
    return this.prisma.db.orm.public.User.where((u) => u.deletedAt.isNull());
  }

  private async setTelegram(
    userId: number,
    fields: {
      telegramId?: string | null;
      telegramUsername?: string | null;
      telegramLinkToken?: string | null;
      telegramLinkExpiresAt?: Date | null;
    },
  ): Promise<void> {
    await this.prisma.db.orm.public.User.where({ id: userId }).update({
      ...UserMapper.toWrite(fields),
      updatedAt: timestamp(toTimestamp(new Date())),
    });
  }

  /** Issues a short-lived token the user pastes to the bot as `/link <token>`. */
  async issueLinkToken(
    userId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await this.setTelegram(userId, {
      telegramLinkToken: token,
      telegramLinkExpiresAt: expiresAt,
    });

    return { token, expiresAt };
  }

  /** Consumes a link token sent from a Telegram chat. */
  async consumeLinkToken(
    token: string,
    telegramId: string,
    telegramUsername?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const user = await this.live().where({ telegramLinkToken: token }).first();

    if (!user) {
      return { ok: false, message: 'That link code is not valid.' };
    }

    if (
      !user.telegramLinkExpiresAt ||
      toDate(user.telegramLinkExpiresAt).getTime() < Date.now()
    ) {
      return {
        ok: false,
        message:
          'That link code has expired. Generate a new one from your profile.',
      };
    }

    const taken = await this.live()
      .where({ telegramId: BigInt(telegramId) })
      .first();
    if (taken && taken.id !== user.id) {
      return {
        ok: false,
        message: 'This Telegram account is already linked to another profile.',
      };
    }

    await this.setTelegram(user.id, {
      telegramId,
      telegramUsername: telegramUsername ?? null,
      telegramLinkToken: null,
      telegramLinkExpiresAt: null,
    });

    return {
      ok: true,
      message:
        `Linked to ${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    };
  }

  /** Credentials-based linking, used by the Mini App's link screen. */
  async linkWithCredentials(
    email: string,
    password: string,
    telegramId: string,
    telegramUsername?: string,
  ): Promise<void> {
    const user = await this.live().where({ email }).first();

    // One message for every failure mode: no account enumeration here either.
    const invalid = new UnprocessableEntityException(
      'Email or password is incorrect.',
    );

    if (!user?.password || !user.active) throw invalid;
    if (!(await bcrypt.compare(password, user.password))) throw invalid;

    const taken = await this.live()
      .where({ telegramId: BigInt(telegramId) })
      .first();
    if (taken && taken.id !== user.id) {
      throw new UnprocessableEntityException(
        'This Telegram account is already linked to another profile.',
      );
    }

    await this.setTelegram(user.id, {
      telegramId,
      telegramUsername: telegramUsername ?? null,
      telegramLinkToken: null,
      telegramLinkExpiresAt: null,
    });
  }

  async unlink(userId: number): Promise<void> {
    await this.setTelegram(userId, {
      telegramId: null,
      telegramUsername: null,
      telegramLinkToken: null,
      telegramLinkExpiresAt: null,
    });
  }

  async findByTelegramId(telegramId: string): Promise<User | null> {
    if (!/^\d+$/.test(telegramId)) return null;

    const row = await this.live()
      .include('role')
      .include('photo')
      .where({ telegramId: BigInt(telegramId), active: true })
      .first();
    return row ? UserMapper.toDomain(row) : null;
  }
}
