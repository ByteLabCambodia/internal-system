import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Two ways to link a Telegram account to a profile (Part 1 §2.8):
 *   - a one-time token generated on the profile page and sent to the bot, and
 *   - a credentials endpoint for the Mini App's "link account" screen.
 */
@Injectable()
export class TelegramLinkService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  /** Issues a short-lived token the user pastes to the bot as `/link <token>`. */
  async issueLinkToken(
    userId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await this.users.update(userId, {
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
    const user = await this.users.findOne({
      where: { telegramLinkToken: token },
    });

    if (!user) {
      return { ok: false, message: 'That link code is not valid.' };
    }

    if (
      !user.telegramLinkExpiresAt ||
      user.telegramLinkExpiresAt.getTime() < Date.now()
    ) {
      return {
        ok: false,
        message:
          'That link code has expired. Generate a new one from your profile.',
      };
    }

    const taken = await this.users.findOne({ where: { telegramId } });
    if (taken && taken.id !== user.id) {
      return {
        ok: false,
        message: 'This Telegram account is already linked to another profile.',
      };
    }

    await this.users.update(user.id, {
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
    const user = await this.users.findOne({ where: { email } });

    // One message for every failure mode: no account enumeration here either.
    const invalid = new UnprocessableEntityException(
      'Email or password is incorrect.',
    );

    if (!user?.password || !user.active) throw invalid;
    if (!(await bcrypt.compare(password, user.password))) throw invalid;

    const taken = await this.users.findOne({ where: { telegramId } });
    if (taken && taken.id !== user.id) {
      throw new UnprocessableEntityException(
        'This Telegram account is already linked to another profile.',
      );
    }

    await this.users.update(user.id, {
      telegramId,
      telegramUsername: telegramUsername ?? null,
      telegramLinkToken: null,
      telegramLinkExpiresAt: null,
    });
  }

  async unlink(userId: number): Promise<void> {
    await this.users.update(userId, {
      telegramId: null,
      telegramUsername: null,
      telegramLinkToken: null,
      telegramLinkExpiresAt: null,
    });
  }

  findByTelegramId(telegramId: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { telegramId, active: true } });
  }
}
