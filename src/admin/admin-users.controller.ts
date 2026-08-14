import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { WebAuthService } from '../auth/web/web-auth.service';
import { AuthTokensService } from '../auth/auth-tokens.service';
import { AuthTokenPurposeEnum } from '../auth/entities/auth-token.entity';
import { ActivityService } from '../activity/activity.service';
import { RoleEnum } from '../roles/roles.enum';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { CreateUserFormDto, UpdateUserFormDto } from './dto/user-form.dto';

const ROLE_OPTIONS = [
  { id: RoleEnum.admin, label: 'Admin' },
  { id: RoleEnum.manager, label: 'Manager' },
  { id: RoleEnum.finance, label: 'Finance' },
  { id: RoleEnum.employee, label: 'Employee' },
];

@RequirePermission(PermissionEnum['users.manage'])
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly webAuth: WebAuthService,
    private readonly tokens: AuthTokensService,
    private readonly activity: ActivityService,
  ) {}

  /** A user with no password and an unused invite token is "pending invite". */
  private async listRows() {
    const rows = await this.users.find({ order: { id: 'ASC' } });

    const pending = new Set<number>();
    for (const row of rows) {
      if (!row.password && (await this.tokens.hasPendingInvite(row.id))) {
        pending.add(row.id);
      }
    }

    return rows.map((row) => ({
      ...row,
      pendingInvite: pending.has(row.id),
      // No password and no live invite: the account cannot be signed into at all.
      stranded: !row.password && !pending.has(row.id),
    }));
  }

  private async render(
    response: Response,
    extra: Record<string, unknown> = {},
  ) {
    return response.render('admin/users', {
      title: 'Users',
      rows: await this.listRows(),
      roles: ROLE_OPTIONS,
      values: {},
      errors: {},
      editing: null,
      ...extra,
    });
  }

  @Get()
  list(@Res() response: Response) {
    return this.render(response);
  }

  @Get(':id/edit')
  async edit(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
    @Query('sent') sent?: string,
  ) {
    const editing = await this.users.findOne({ where: { id } });

    return this.render(response, {
      editing,
      values: editing
        ? {
            firstName: editing.firstName,
            lastName: editing.lastName,
            email: editing.email,
            roleId: editing.role?.id,
            department: editing.department,
            telegramId: editing.telegramId,
            active: editing.active,
          }
        : {},
      sent,
    });
  }

  /**
   * Create. Two modes on one form (Part 1 §2.10):
   *   - invite: no password is stored, a single-use 7-day link is emailed;
   *   - password: an initial password is set and the account is flagged
   *     must_change_password so it cannot stay the admin's choice.
   */
  @Post()
  async create(@Body() body: CreateUserFormDto, @Res() response: Response) {
    const form = await validateForm(CreateUserFormDto, body);

    if (!form.ok) {
      return response.status(422).render('admin/users', {
        title: 'Users',
        rows: await this.listRows(),
        roles: ROLE_OPTIONS,
        values: body,
        errors: form.errors,
        editing: null,
      });
    }

    const dto = form.data;
    const usePassword = dto.mode === 'password';

    if (usePassword && (!dto.password || dto.password.length < 8)) {
      return response.status(422).render('admin/users', {
        title: 'Users',
        rows: await this.listRows(),
        roles: ROLE_OPTIONS,
        values: body,
        errors: { password: 'Use at least 8 characters' },
        editing: null,
      });
    }

    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) {
      return response.status(422).render('admin/users', {
        title: 'Users',
        rows: await this.listRows(),
        roles: ROLE_OPTIONS,
        values: body,
        errors: { email: 'That email already has an account' },
        editing: null,
      });
    }

    const created = await this.usersService.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      role: { id: dto.roleId },
      active: true,
      ...(usePassword ? { password: dto.password } : {}),
    });

    if (usePassword) {
      await this.users.update(Number(created.id), {
        mustChangePassword: true,
        department: dto.department ?? null,
      });
    } else {
      await this.users.update(Number(created.id), {
        department: dto.department ?? null,
      });
    }

    const actor = response.locals.currentUser;

    await this.activity.log({
      entityType: 'user',
      entityId: Number(created.id),
      action: usePassword ? 'created_with_password' : 'invited',
      actorId: Number(actor.id),
      detail: { email: dto.email, role: RoleEnum[dto.roleId] },
    });

    if (usePassword) {
      setFlash(
        response,
        'success',
        `${dto.email} created. Pass them the password out of band — they must change it at first sign-in.`,
      );
      return response.redirect('/admin/users');
    }

    const user = await this.usersService.findById(created.id);
    const result = await this.webAuth.sendToken(
      user!,
      AuthTokenPurposeEnum.invite,
      [actor.firstName, actor.lastName].filter(Boolean).join(' '),
    );

    // A bounced invite looks like a broken account, so say so rather than swallowing it.
    setFlash(
      response,
      result.sent ? 'success' : 'error',
      result.sent
        ? `Invite emailed to ${dto.email}.`
        : `${dto.email} was created but the invite email failed to send. Resend it, or set a password directly.`,
    );

    return response.redirect('/admin/users');
  }

  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserFormDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(UpdateUserFormDto, body);
    const editing = await this.users.findOne({ where: { id } });

    if (!form.ok || !editing) {
      return response.status(422).render('admin/users', {
        title: 'Users',
        rows: await this.listRows(),
        roles: ROLE_OPTIONS,
        values: { ...body, id },
        errors: form.ok ? {} : form.errors,
        editing: editing ?? { id },
      });
    }

    const dto = form.data;
    const actor = response.locals.currentUser;
    const deactivating = editing.active && dto.active !== 'true';

    await this.usersService.update(id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      role: { id: dto.roleId },
      active: dto.active === 'true',
    });

    await this.users.update(id, {
      department: dto.department ?? null,
      telegramId: dto.telegramId ? String(dto.telegramId) : null,
    });

    // Deactivating must end the session, not merely block the next sign-in.
    if (deactivating) {
      await this.sessions.deleteByUserId({ userId: id });
    }

    if (dto.password) {
      if (dto.password.length < 8) {
        return response.status(422).render('admin/users', {
          title: 'Users',
          rows: await this.listRows(),
          roles: ROLE_OPTIONS,
          values: { ...body, id },
          errors: { password: 'Use at least 8 characters' },
          editing,
        });
      }

      await this.usersService.update(id, {
        password: dto.password,
        mustChangePassword: true,
      });

      // An admin-set password invalidates any pending invite and every live session.
      await this.tokens.invalidateAll(id, AuthTokenPurposeEnum.invite);
      await this.sessions.deleteByUserId({ userId: id });

      await this.activity.log({
        entityType: 'user',
        entityId: id,
        action: 'password_set_by_admin',
        actorId: Number(actor.id),
        detail: { email: editing.email },
      });
    }

    await this.activity.log({
      entityType: 'user',
      entityId: id,
      action: 'updated',
      actorId: Number(actor.id),
    });

    setFlash(response, 'success', 'User updated.');
    return response.redirect('/admin/users');
  }

  @Post(':id/resend-invite')
  async resendInvite(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const user = await this.usersService.findById(id);

    if (!user) {
      setFlash(response, 'error', 'User not found.');
      return response.redirect('/admin/users');
    }

    // Issuing a new token invalidates the previous one.
    const result = await this.webAuth.sendToken(
      user,
      AuthTokenPurposeEnum.invite,
    );

    await this.activity.log({
      entityType: 'user',
      entityId: id,
      action: 'invite_resent',
      actorId: Number(response.locals.currentUser.id),
    });

    setFlash(
      response,
      result.sent ? 'success' : 'error',
      result.sent
        ? `Invite re-sent to ${user.email}.`
        : `Could not send the invite to ${user.email}. Check the mail settings.`,
    );

    return response.redirect('/admin/users');
  }

  @Post(':id/revoke-invite')
  async revokeInvite(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    await this.tokens.invalidateAll(id, AuthTokenPurposeEnum.invite);

    await this.activity.log({
      entityType: 'user',
      entityId: id,
      action: 'invite_revoked',
      actorId: Number(response.locals.currentUser.id),
    });

    setFlash(
      response,
      'success',
      'Invite revoked. The link no longer works; send a new invite or set a password.',
    );

    return response.redirect('/admin/users');
  }

  @Post(':id/send-reset')
  async sendReset(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const user = await this.usersService.findById(id);

    if (!user) {
      setFlash(response, 'error', 'User not found.');
      return response.redirect('/admin/users');
    }

    const result = await this.webAuth.sendToken(
      user,
      AuthTokenPurposeEnum.reset,
    );

    setFlash(
      response,
      result.sent ? 'success' : 'error',
      result.sent
        ? `Password reset emailed to ${user.email}.`
        : `Could not send the reset email to ${user.email}.`,
    );

    return response.redirect('/admin/users');
  }

  @Post(':id/delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const actor = response.locals.currentUser;

    if (Number(actor.id) === id) {
      setFlash(response, 'error', 'You cannot delete your own account.');
      return response.redirect('/admin/users');
    }

    // Never leave the system with no way in.
    const otherAdmins = await this.users.count({
      where: { role: { id: RoleEnum.admin }, active: true, id: Not(id) },
    });

    const target = await this.users.findOne({ where: { id } });
    if (target?.role?.id === RoleEnum.admin && otherAdmins === 0) {
      setFlash(response, 'error', 'This is the last active admin.');
      return response.redirect('/admin/users');
    }

    try {
      await this.sessions.deleteByUserId({ userId: id });
      await this.usersService.remove(id);

      await this.activity.log({
        entityType: 'user',
        entityId: id,
        action: 'deleted',
        actorId: Number(actor.id),
        detail: { email: target?.email },
      });

      setFlash(response, 'success', 'User deleted.');
    } catch {
      setFlash(
        response,
        'error',
        'This user has records attached and cannot be deleted. Deactivate them instead.',
      );
    }

    return response.redirect('/admin/users');
  }

  /** Accounts that can never sign in: no password and no live invite. */
  @Get('stranded')
  async stranded(@Res() response: Response) {
    const rows = await this.users.find({
      where: { password: IsNull(), email: Not(IsNull()) },
    });

    return response.json({ count: rows.length });
  }
}
