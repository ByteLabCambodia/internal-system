import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService } from '../auth.service';
import { AuthTokensService } from '../auth-tokens.service';
import { AuthTokenPurposeEnum } from '../entities/auth-token.entity';
import { MailService } from '../../mail/mail.service';
import { SessionService } from '../../session/session.service';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/domain/user';
import { LoginResponseDto } from '../dto/login-response.dto';

export type SignInResult =
  | { ok: true; tokens: LoginResponseDto; user: User }
  | { ok: false; reason: 'invalid' | 'inactive' | 'invite_pending' };

export type TokenPageResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' };

/**
 * Browser-side auth. The rules it has to hold (Part 1 §2.10):
 *   - sign-in failures never say which field was wrong;
 *   - forgot-password renders the same confirmation whether or not the email exists;
 *   - "no password" is never "any password" — an invited user cannot sign in;
 *   - an inactive user cannot sign in, and completing a reset kills other sessions.
 */
@Injectable()
export class WebAuthService {
  private readonly logger = new Logger(WebAuthService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly tokensService: AuthTokensService,
    private readonly mailService: MailService,
  ) {}

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      return { ok: false, reason: 'invalid' };
    }

    // An invited user who has not set a password yet. Told apart from a wrong password on
    // purpose: the brief wants the sign-in page to offer to resend the invite.
    if (!user.password) {
      return { ok: false, reason: 'invite_pending' };
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return { ok: false, reason: 'invalid' };
    }

    if (!user.active) {
      return { ok: false, reason: 'inactive' };
    }

    const tokens = await this.authService.createSessionForUser(user);

    return { ok: true, tokens, user };
  }

  /**
   * Always resolves the same way — the caller renders one confirmation regardless, so the
   * page never reveals which addresses are registered.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.active) return;

    // A user who never set a password gets their invite reissued rather than a reset link.
    const purpose = user.password
      ? AuthTokenPurposeEnum.reset
      : AuthTokenPurposeEnum.invite;

    await this.sendToken(user, purpose);
  }

  async resendInvite(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.active || user.password) return;

    await this.sendToken(user, AuthTokenPurposeEnum.invite);
  }

  /** Issues a token and mails it. Send failures are logged and surfaced, never swallowed. */
  async sendToken(
    user: User,
    purpose: AuthTokenPurposeEnum,
    invitedBy?: string,
  ): Promise<{ sent: boolean; token: string }> {
    const { token, expiresAt } = await this.tokensService.issue(
      Number(user.id),
      purpose,
    );

    try {
      if (purpose === AuthTokenPurposeEnum.invite) {
        await this.mailService.userInvite({
          to: user.email!,
          data: { token, expiresAt, invitedBy },
        });
      } else {
        await this.mailService.passwordResetLink({
          to: user.email!,
          data: { token, expiresAt },
        });
      }

      return { sent: true, token };
    } catch (error) {
      this.logger.error(
        `Failed to send ${purpose} email to ${user.email}: ${error}`,
      );
      return { sent: false, token };
    }
  }

  peekToken(
    token: string,
    purpose: AuthTokenPurposeEnum,
  ): Promise<TokenPageResult> {
    return this.tokensService.peek(token, purpose);
  }

  /**
   * Consumes the token, sets the password, clears must_change_password, and drops every
   * other session for that user.
   */
  async completePasswordSet(
    token: string,
    purpose: AuthTokenPurposeEnum,
    password: string,
  ): Promise<TokenPageResult> {
    const consumed = await this.tokensService.consume(token, purpose);
    if (!consumed.ok) return consumed;

    const user = await this.usersService.findById(consumed.userId);
    if (!user) return { ok: false, reason: 'unknown' };

    await this.setPassword(consumed.userId, password);

    return { ok: true, userId: consumed.userId };
  }

  /** Used by the forced-change flow too, where there is no token to consume. */
  async setPassword(userId: number, password: string): Promise<User | null> {
    await this.sessionService.deleteByUserId({ userId });

    return this.usersService.update(userId, {
      password,
      mustChangePassword: false,
    });
  }

  /** Session for a user who has just proved themselves with a single-use token. */
  signInWithoutPassword(user: User): Promise<LoginResponseDto> {
    return this.authService.createSessionForUser(user);
  }

  async findUser(userId: number | string): Promise<User | null> {
    return this.usersService.findById(userId);
  }

  hasPendingInvite(userId: number): Promise<boolean> {
    return this.tokensService.hasPendingInvite(userId);
  }
}
