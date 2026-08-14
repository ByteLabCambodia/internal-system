import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { WebAuthService } from './web-auth.service';
import { AuthTokenPurposeEnum } from '../entities/auth-token.entity';
import { SignInFormDto } from './dto/sign-in-form.dto';
import { EmailFormDto } from './dto/email-form.dto';
import { NewPasswordFormDto } from './dto/new-password-form.dto';
import { PublicPage } from '../../common/web/public-page.decorator';
import { validateForm } from '../../common/web/validate-form';
import { setFlash } from '../../common/web/flash';
import {
  clearAuthCookies,
  setAuthCookies,
} from '../../common/web/auth-cookies';

/** Sign-in and forgot-password are rate limited per IP: 10 attempts a minute. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * The four public auth pages, and nothing else. There is no sign-up route and no social
 * login — accounts are created by an admin (Part 1 §2.10).
 */
@Controller()
export class AuthWebController {
  constructor(private readonly webAuth: WebAuthService) {}

  private isSafeNext(next?: string): boolean {
    return !!next && next.startsWith('/') && !next.startsWith('//');
  }

  // --- sign in ---------------------------------------------------------------------
  @PublicPage()
  @Get('login')
  showLogin(
    @Req() request: Request,
    @Res() response: Response,
    @Query('next') next?: string,
  ) {
    if (response.locals.currentUser) {
      return response.redirect(this.isSafeNext(next) ? next! : '/dashboard');
    }

    return response.render('auth/login', {
      layout: 'layouts/auth',
      title: 'Sign in',
      values: {},
      errors: {},
      next,
      invitePending: false,
    });
  }

  @PublicPage()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async signIn(@Body() body: SignInFormDto, @Res() response: Response) {
    const form = await validateForm(SignInFormDto, body);

    const render = (
      errors: Record<string, string>,
      extra: Record<string, unknown> = {},
    ) =>
      response.status(422).render('auth/login', {
        layout: 'layouts/auth',
        title: 'Sign in',
        values: { email: body?.email ?? '' },
        errors,
        next: body?.next,
        invitePending: false,
        ...extra,
      });

    if (!form.ok) {
      return render(form.errors);
    }

    const result = await this.webAuth.signIn(
      form.data.email,
      form.data.password,
    );

    if (!result.ok) {
      if (result.reason === 'invite_pending') {
        return render(
          {},
          {
            invitePending: true,
            values: { email: form.data.email },
            alert:
              'Your invite is still pending — set a password using the link we emailed you.',
          },
        );
      }

      if (result.reason === 'inactive') {
        return render({}, { alert: 'This account has been deactivated.' });
      }

      // Never say which of the two was wrong.
      return render({}, { alert: 'Email or password is incorrect.' });
    }

    setAuthCookies(response, result.tokens);

    if (result.user.mustChangePassword) {
      return response.redirect('/set-password');
    }

    return response.redirect(
      this.isSafeNext(form.data.next) ? form.data.next! : '/dashboard',
    );
  }

  @PublicPage()
  @Post('logout')
  logout(@Res() response: Response) {
    clearAuthCookies(response);
    setFlash(response, 'success', 'You have been signed out.');
    return response.redirect('/login');
  }

  // --- forgot password ---------------------------------------------------------------
  @PublicPage()
  @Get('forgot-password')
  showForgotPassword(@Res() response: Response) {
    return response.render('auth/forgot-password', {
      layout: 'layouts/auth',
      title: 'Forgot password',
      values: {},
      errors: {},
      sent: false,
    });
  }

  @PublicPage()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  async forgotPassword(@Body() body: EmailFormDto, @Res() response: Response) {
    const form = await validateForm(EmailFormDto, body);

    if (!form.ok) {
      return response.status(422).render('auth/forgot-password', {
        layout: 'layouts/auth',
        title: 'Forgot password',
        values: { email: body?.email ?? '' },
        errors: form.errors,
        sent: false,
      });
    }

    await this.webAuth.requestPasswordReset(form.data.email);

    // Same confirmation either way — never reveal which addresses are registered.
    return response.render('auth/forgot-password', {
      layout: 'layouts/auth',
      title: 'Check your email',
      values: {},
      errors: {},
      sent: true,
    });
  }

  @PublicPage()
  @Throttle(AUTH_THROTTLE)
  @Post('resend-invite')
  async resendInvite(@Body() body: EmailFormDto, @Res() response: Response) {
    const form = await validateForm(EmailFormDto, body);

    if (form.ok) {
      await this.webAuth.resendInvite(form.data.email);
    }

    setFlash(
      response,
      'success',
      'If that account is awaiting an invite, a new link is on its way.',
    );
    return response.redirect('/login');
  }

  // --- reset password (emailed token) --------------------------------------------------
  @PublicPage()
  @Get('reset-password')
  async showResetPassword(
    @Res() response: Response,
    @Query('token') token?: string,
  ) {
    return this.renderTokenPage(
      response,
      AuthTokenPurposeEnum.reset,
      'auth/reset-password',
      'Choose a new password',
      token,
    );
  }

  @PublicPage()
  @Post('reset-password')
  async resetPassword(
    @Body() body: NewPasswordFormDto,
    @Res() response: Response,
  ) {
    return this.handlePasswordSubmit(
      body,
      response,
      AuthTokenPurposeEnum.reset,
      'auth/reset-password',
      'Choose a new password',
    );
  }

  // --- set password (invite landing, and the forced change after an admin set one) ------
  @PublicPage()
  @Get('set-password')
  async showSetPassword(
    @Res() response: Response,
    @Query('token') token?: string,
  ) {
    // Signed in with must_change_password: no token involved, just a forced change.
    if (!token && response.locals.currentUser) {
      return response.render('auth/set-password', {
        layout: 'layouts/auth',
        title: 'Choose a new password',
        values: {},
        errors: {},
        token: undefined,
        forced: true,
        tokenProblem: null,
      });
    }

    return this.renderTokenPage(
      response,
      AuthTokenPurposeEnum.invite,
      'auth/set-password',
      'Set your password',
      token,
    );
  }

  @PublicPage()
  @Post('set-password')
  async setPassword(
    @Body() body: NewPasswordFormDto,
    @Res() response: Response,
  ) {
    // Forced change for the signed-in user — no token to consume.
    if (!body?.token && response.locals.currentUser) {
      const form = await validateForm(NewPasswordFormDto, body);

      if (!form.ok || form.data.password !== form.data.passwordConfirmation) {
        return response.status(422).render('auth/set-password', {
          layout: 'layouts/auth',
          title: 'Choose a new password',
          values: {},
          errors: form.ok
            ? { passwordConfirmation: 'Both passwords must match' }
            : form.errors,
          token: undefined,
          forced: true,
          tokenProblem: null,
        });
      }

      await this.webAuth.setPassword(
        Number(response.locals.currentUser.id),
        form.data.password,
      );

      clearAuthCookies(response);
      setFlash(
        response,
        'success',
        'Password changed. Please sign in with your new password.',
      );
      return response.redirect('/login');
    }

    return this.handlePasswordSubmit(
      body,
      response,
      AuthTokenPurposeEnum.invite,
      'auth/set-password',
      'Set your password',
    );
  }

  // --- shared token-page plumbing --------------------------------------------------------
  private async renderTokenPage(
    response: Response,
    purpose: AuthTokenPurposeEnum,
    view: string,
    title: string,
    token?: string,
  ) {
    const problem = token
      ? await this.webAuth.peekToken(token, purpose)
      : ({ ok: false, reason: 'unknown' } as const);

    return response.render(view, {
      layout: 'layouts/auth',
      title,
      values: {},
      errors: {},
      token,
      forced: false,
      // An expired or used link explains itself and offers a new one, never a raw error.
      tokenProblem: problem.ok ? null : problem.reason,
    });
  }

  private async handlePasswordSubmit(
    body: NewPasswordFormDto,
    response: Response,
    purpose: AuthTokenPurposeEnum,
    view: string,
    title: string,
  ) {
    const form = await validateForm(NewPasswordFormDto, body);

    const render = (errors: Record<string, string>) =>
      response.status(422).render(view, {
        layout: 'layouts/auth',
        title,
        values: {},
        errors,
        token: body?.token,
        forced: false,
        tokenProblem: null,
      });

    if (!form.ok) return render(form.errors);

    if (form.data.password !== form.data.passwordConfirmation) {
      return render({ passwordConfirmation: 'Both passwords must match' });
    }

    if (!form.data.token) {
      return render({ password: 'This link is no longer valid' });
    }

    const result = await this.webAuth.completePasswordSet(
      form.data.token,
      purpose,
      form.data.password,
    );

    if (!result.ok) {
      return response.status(422).render(view, {
        layout: 'layouts/auth',
        title,
        values: {},
        errors: {},
        token: undefined,
        forced: false,
        tokenProblem: result.reason,
      });
    }

    const user = await this.webAuth.findUser(result.userId);

    // Signed in straight after setting the password, as the brief asks for the invite flow.
    if (user?.active) {
      const signedIn = await this.webAuth.signInWithoutPassword(user);
      setAuthCookies(response, signedIn);
      setFlash(response, 'success', 'Your password has been set.');
      return response.redirect('/dashboard');
    }

    setFlash(
      response,
      'success',
      'Your password has been set. Please sign in.',
    );
    return response.redirect('/login');
  }
}
