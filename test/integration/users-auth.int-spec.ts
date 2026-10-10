import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import bcrypt from 'bcryptjs';
import { createTestApp, resetData } from './support/test-app';
import { q, seedRoles, seedWorld, World } from './support/fixtures';
import { UsersService } from '../../src/users/users.service';
import { SessionService } from '../../src/session/session.service';
import { AuthTokensService } from '../../src/auth/auth-tokens.service';
import { AuthTokenPurposeEnum } from '../../src/auth/entities/auth-token.entity';
import { TelegramLinkService } from '../../src/telegram/telegram-link.service';
import { RoleEnum } from '../../src/roles/roles.enum';
import { User } from '../../src/users/domain/user';

/**
 * Users, sessions, auth tokens and Telegram linking: written against the TypeORM
 * implementation first, then kept green through the move to Prisma.
 */
describe('users, sessions, auth tokens and Telegram linking', () => {
  let app: TestingModule;
  let db: DataSource;
  let world: World;
  let users: UsersService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    users = app.get(UsersService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
  });

  const newUser = (email: string, extra: Record<string, unknown> = {}) =>
    users.create({
      email,
      password: 'secret123',
      firstName: 'Dara',
      lastName: 'Sok',
      role: { id: RoleEnum.finance },
      ...extra,
    } as never);

  describe('UsersService', () => {
    it('should create a user with a hashed password, the role loaded and real dates', async () => {
      const user = await newUser('dara@test.local');

      expect(user.role?.id).toBe(RoleEnum.finance);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(Math.abs(user.createdAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );

      const found = (await users.findByEmail('dara@test.local'))!;
      expect(found.id).toBe(user.id);
      expect(await bcrypt.compare('secret123', found.password!)).toBe(true);
      expect(found.role).toMatchObject({ id: RoleEnum.finance });
      expect(found.active).toBe(true);
    });

    it('should refuse a second account with the same email', async () => {
      await newUser('dup@test.local');
      await expect(newUser('dup@test.local')).rejects.toMatchObject({
        response: { errors: { email: 'emailAlreadyExists' } },
      });
    });

    it('should find by id and ids, and return telegramId as a string', async () => {
      await db.query(
        `UPDATE "user" SET telegram_id = 7123456789012 WHERE id = $1`,
        [world.manager.id],
      );

      const manager = (await users.findById(world.manager.id))!;
      expect(manager.telegramId).toBe('7123456789012');
      expect(manager.role).toMatchObject({ id: RoleEnum.manager });

      const both = await users.findByIds([world.admin.id, world.manager.id]);
      expect(both.map((u) => u.id).sort()).toEqual(
        [world.admin.id, world.manager.id].sort(),
      );
      expect(await users.findById(999999)).toBeNull();
    });

    it('should update named fields, re-hash a changed password and stamp updatedAt', async () => {
      const user = await newUser('upd@test.local');
      await db.query(
        `UPDATE "user" SET "updatedAt" = now() - interval '1 day' WHERE id = $1`,
        [user.id],
      );

      const updated = (await users.update(user.id, {
        firstName: 'Dara 2',
        password: 'newpass123',
      }))!;

      expect(updated.firstName).toBe('Dara 2');
      expect(updated.lastName).toBe('Sok');
      expect(await bcrypt.compare('newpass123', updated.password!)).toBe(true);
      const row = await q(
        db,
        `SELECT "updatedAt" > now() - interval '1 minute' AS fresh FROM "user" WHERE id = $1`,
        [user.id],
      );
      expect(row.fresh).toBe(true);
    });

    // On TypeORM this failed: the mapper turned every unmentioned department,
    // payment_link and payment_qr_object_key into null, so a password reset erased them.
    it('should keep fields an update does not mention', async () => {
      const user = await newUser('keep@test.local');
      await db.query(
        `UPDATE "user" SET department = 'Ops', payment_link = 'https://pay.example/x',
                           telegram_id = 55, telegram_username = 'dara' WHERE id = $1`,
        [user.id],
      );

      // e.g. a password reset or a profile name change
      await users.update(user.id, { mustChangePassword: false });

      const row = await q(
        db,
        `SELECT department, payment_link, telegram_id, telegram_username FROM "user" WHERE id = $1`,
        [user.id],
      );
      expect(row).toEqual({
        department: 'Ops',
        payment_link: 'https://pay.example/x',
        telegram_id: '55',
        telegram_username: 'dara',
      });
    });

    it('should soft-delete: the row stays but the user is no longer found', async () => {
      const user = await newUser('gone@test.local');
      await users.remove(user.id);

      expect(await users.findById(user.id)).toBeNull();
      expect(await users.findByEmail('gone@test.local')).toBeNull();
      const row = await q(db, `SELECT "deletedAt" FROM "user" WHERE id = $1`, [
        user.id,
      ]);
      expect(row.deletedAt).not.toBeNull();
    });

    it('should page, filter by role and sort', async () => {
      await newUser('a@test.local', { firstName: 'Zed' });
      await newUser('b@test.local', { firstName: 'Amy' });

      const finance = await users.findManyWithPagination({
        filterOptions: { roles: [{ id: RoleEnum.finance }] } as never,
        sortOptions: [{ orderBy: 'firstName', order: 'ASC' } as never],
        paginationOptions: { page: 1, limit: 10 },
      });
      expect(finance.map((u) => u.firstName)).toEqual([
        'Amy',
        'finance', // case-insensitive collation
        'Zed',
      ]);

      const page2 = await users.findManyWithPagination({
        sortOptions: [{ orderBy: 'id', order: 'ASC' } as never],
        paginationOptions: { page: 2, limit: 2 },
      });
      expect(page2.map((u) => u.id)).toEqual([
        world.finance.id,
        world.employee.id,
      ]);
    });
  });

  describe('SessionService', () => {
    let sessions: SessionService;
    beforeEach(() => (sessions = app.get(SessionService)));

    const user = () => ({ id: world.manager.id }) as User;

    it('should create a session and load it with its user and role', async () => {
      const session = await sessions.create({
        user: user(),
        hash: 'h1',
      } as never);
      const found = (await sessions.findById(session.id))!;

      expect(found.hash).toBe('h1');
      expect(found.user.id).toBe(world.manager.id);
      expect(found.user.role).toMatchObject({ id: RoleEnum.manager });
    });

    it('should rotate the hash only when the old hash matches', async () => {
      const session = await sessions.create({
        user: user(),
        hash: 'old',
      } as never);

      expect(
        await sessions.updateByHash(
          { id: session.id, hash: 'wrong' },
          { hash: 'new' },
        ),
      ).toBeNull();
      const rotated = await sessions.updateByHash(
        { id: session.id, hash: 'old' },
        { hash: 'new' },
      );
      expect(rotated?.hash).toBe('new');
    });

    it('should soft-delete one session, all of a user’s, or all but one', async () => {
      const a = await sessions.create({ user: user(), hash: 'a' } as never);
      const b = await sessions.create({ user: user(), hash: 'b' } as never);
      const c = await sessions.create({ user: user(), hash: 'c' } as never);

      await sessions.deleteById(a.id);
      expect(await sessions.findById(a.id)).toBeNull();

      await sessions.deleteByUserIdWithExclude({
        userId: world.manager.id,
        excludeSessionId: c.id,
      });
      expect(await sessions.findById(b.id)).toBeNull();
      expect(await sessions.findById(c.id)).not.toBeNull();

      await sessions.deleteByUserId({ userId: world.manager.id });
      expect(await sessions.findById(c.id)).toBeNull();

      const rows = await db.query(`SELECT "deletedAt" FROM session`);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.deletedAt !== null)).toBe(true);
    });
  });

  describe('AuthTokensService', () => {
    let tokens: AuthTokensService;
    beforeEach(() => (tokens = app.get(AuthTokensService)));

    it('should issue a token that can be peeked, then consumed once', async () => {
      const userId = Number(world.employee.id);
      const { token } = await tokens.issue(userId, AuthTokenPurposeEnum.reset);

      expect(await tokens.peek(token, AuthTokenPurposeEnum.reset)).toEqual({
        ok: true,
        userId,
      });
      expect(await tokens.consume(token, AuthTokenPurposeEnum.reset)).toEqual({
        ok: true,
        userId,
      });
      expect(await tokens.consume(token, AuthTokenPurposeEnum.reset)).toEqual({
        ok: false,
        reason: 'used',
      });
      expect(await tokens.consume(token, AuthTokenPurposeEnum.invite)).toEqual({
        ok: false,
        reason: 'unknown',
      });
    });

    it('should reject an expired token and store only the hash', async () => {
      const { token } = await tokens.issue(
        Number(world.employee.id),
        AuthTokenPurposeEnum.reset,
      );
      await db.query(
        `UPDATE auth_tokens SET expires_at = now() - interval '1 minute'`,
      );

      expect(await tokens.consume(token, AuthTokenPurposeEnum.reset)).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(
        await db.query(`SELECT 1 FROM auth_tokens WHERE token_hash = $1`, [
          token,
        ]),
      ).toHaveLength(0);
    });

    it('should replace older tokens and report a pending invite until it is used', async () => {
      const userId = Number(world.employee.id);
      const first = await tokens.issue(userId, AuthTokenPurposeEnum.invite);
      const second = await tokens.issue(userId, AuthTokenPurposeEnum.invite);

      expect(
        (await tokens.peek(first.token, AuthTokenPurposeEnum.invite)).ok,
      ).toBe(false);
      expect(await tokens.hasPendingInvite(userId)).toBe(true);

      await tokens.consume(second.token, AuthTokenPurposeEnum.invite);
      expect(await tokens.hasPendingInvite(userId)).toBe(false);
    });
  });

  describe('TelegramLinkService', () => {
    let links: TelegramLinkService;
    beforeEach(() => (links = app.get(TelegramLinkService)));

    it('should link with a fresh code, once, and find the user by Telegram id', async () => {
      const { token } = await links.issueLinkToken(Number(world.employee.id));

      expect(
        await links.consumeLinkToken(token, '9000000001', 'dara'),
      ).toMatchObject({
        ok: true,
      });
      expect(await links.consumeLinkToken(token, '9000000001')).toMatchObject({
        ok: false,
        message: 'That link code is not valid.',
      });

      const linked = await links.findByTelegramId('9000000001');
      expect(linked?.id).toBe(world.employee.id);
      expect(linked?.role).toMatchObject({ id: RoleEnum.employee });
      const row = await q(
        db,
        `SELECT telegram_id, telegram_username, telegram_link_token FROM "user" WHERE id = $1`,
        [world.employee.id],
      );
      expect(row).toEqual({
        telegram_id: '9000000001',
        telegram_username: 'dara',
        telegram_link_token: null,
      });
    });

    it('should refuse an expired code and a Telegram account linked elsewhere', async () => {
      const { token } = await links.issueLinkToken(Number(world.employee.id));
      await db.query(
        `UPDATE "user" SET telegram_link_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [world.employee.id],
      );
      expect((await links.consumeLinkToken(token, '1')).message).toMatch(
        /expired/,
      );

      await db.query(`UPDATE "user" SET telegram_id = 77 WHERE id = $1`, [
        world.manager.id,
      ]);
      const fresh = await links.issueLinkToken(Number(world.employee.id));
      expect(await links.consumeLinkToken(fresh.token, '77')).toMatchObject({
        ok: false,
        message: 'This Telegram account is already linked to another profile.',
      });
    });

    it('should link with credentials, refuse bad ones the same way, and unlink', async () => {
      await newUser('cred@test.local');
      const credUser = (await users.findByEmail('cred@test.local'))!;

      await expect(
        links.linkWithCredentials('cred@test.local', 'wrong', '424242'),
      ).rejects.toThrow('Email or password is incorrect.');
      await expect(
        links.linkWithCredentials('nobody@test.local', 'secret123', '424242'),
      ).rejects.toThrow('Email or password is incorrect.');

      await links.linkWithCredentials(
        'cred@test.local',
        'secret123',
        '424242',
        'cred',
      );
      expect((await links.findByTelegramId('424242'))?.id).toBe(credUser.id);

      await links.unlink(Number(credUser.id));
      expect(await links.findByTelegramId('424242')).toBeNull();
    });

    it('should not find an inactive user by Telegram id', async () => {
      await db.query(
        `UPDATE "user" SET telegram_id = 31, active = false WHERE id = $1`,
        [world.finance.id],
      );
      expect(await links.findByTelegramId('31')).toBeNull();
    });
  });
});
