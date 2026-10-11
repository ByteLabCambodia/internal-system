import { TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { createTestApp, resetData, telegramStub } from './support/test-app';
import { TestDb } from './support/test-db';
import { q, seedRoles, seedWorld, World } from './support/fixtures';
import { OrgService } from '../../src/org/org.service';
import { ApprovalThresholdsService } from '../../src/org/approval-thresholds.service';
import { SuppliersService } from '../../src/org/suppliers.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { TelegramController } from '../../src/telegram/telegram.controller';
import { FileRelationalRepository } from '../../src/files/infrastructure/persistence/relational/repositories/file.repository';
import { RoleEnum } from '../../src/roles/roles.enum';

/** Org, notifications, the Telegram update log and files, after the move to Prisma. */
describe('org, notifications, telegram updates and files', () => {
  let app: TestingModule;
  let db: TestDb;
  let world: World;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(TestDb);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
    telegramStub.isConfigured = false;
    telegramStub.send.mockReset().mockResolvedValue(null);
  });

  describe('OrgService', () => {
    let org: OrgService;
    beforeEach(() => (org = app.get(OrgService)));

    it('should create, rename, deactivate and delete departments and projects', async () => {
      await org.create('department', '  Sales ');
      await org.create('department', 'Admin');
      await org.create('project', 'Website');

      const sales = (await org.findAllDepartments()).find(
        (d) => d.name === 'Sales',
      )!;
      expect(sales).toBeDefined(); // trimmed

      await org.rename('department', sales.id, 'Sales & Marketing');
      await org.toggleActive('department', sales.id);

      expect((await org.findActiveDepartments()).map((d) => d.name)).toEqual([
        'Admin',
        'Ops',
      ]);
      expect((await org.findAllDepartments()).map((d) => d.name)).toEqual([
        'Admin',
        'Ops',
        'Sales & Marketing',
      ]);

      await org.toggleActive('department', sales.id);
      expect((await org.findActiveDepartments()).map((d) => d.name)).toContain(
        'Sales & Marketing',
      );

      await org.remove('department', sales.id);
      expect((await org.findAllDepartments()).map((d) => d.name)).toEqual([
        'Admin',
        'Ops',
      ]);
      expect((await org.findActiveProjects()).map((p) => p.name)).toEqual([
        'Fit-out',
        'Website',
      ]);
    });

    it('should ignore toggling a department that does not exist', async () => {
      await expect(
        org.toggleActive('department', 9999),
      ).resolves.toBeUndefined();
    });

    it('should stamp updated_at on rename', async () => {
      await db.query(
        `UPDATE departments SET updated_at = now() - interval '1 day' WHERE id = $1`,
        [world.departmentId],
      );
      await org.rename('department', world.departmentId, 'Operations');
      const row = await q(
        db,
        `SELECT updated_at > now() - interval '1 minute' AS fresh FROM departments WHERE id = $1`,
        [world.departmentId],
      );
      expect(row.fresh).toBe(true);
    });
  });

  describe('ApprovalThresholdsService', () => {
    let thresholds: ApprovalThresholdsService;
    beforeEach(() => (thresholds = app.get(ApprovalThresholdsService)));

    it('should refuse a role with no limit row, naming who can approve', async () => {
      await thresholds.setLimit(RoleEnum.admin, null);
      expect(await thresholds.check(RoleEnum.manager, '10')).toEqual({
        ok: false,
        limit: '0',
        requiredRole: 'admin',
      });
    });

    it('should enforce a limit and point at the tightest role that covers it', async () => {
      await thresholds.setLimit(RoleEnum.manager, '500.0000');
      await thresholds.setLimit(RoleEnum.finance, '2000.0000');
      await thresholds.setLimit(RoleEnum.admin, null);

      expect(await thresholds.check(RoleEnum.manager, '499.99')).toEqual({
        ok: true,
      });
      expect(await thresholds.check(RoleEnum.manager, '1000')).toEqual({
        ok: false,
        limit: '500.0000',
        requiredRole: 'finance',
      });
      expect(await thresholds.check(RoleEnum.admin, '1000000')).toEqual({
        ok: true,
      });
    });

    it('should update an existing limit in place and remove it', async () => {
      await thresholds.setLimit(RoleEnum.manager, '500.0000');
      await thresholds.setLimit(RoleEnum.manager, '750.0000');

      const rows = await thresholds.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        maxAmountUsd: '750.0000',
        role: { id: RoleEnum.manager }, // the settings page matches on role.id
      });

      await thresholds.removeLimit(RoleEnum.manager);
      expect(await thresholds.findAll()).toHaveLength(0);
    });
  });

  describe('SuppliersService', () => {
    let suppliers: SuppliersService;
    beforeEach(() => (suppliers = app.get(SuppliersService)));

    it('should reuse a supplier whose name matches ignoring case and spaces', async () => {
      const first = await suppliers.findOrCreateByName('  ABC Co. ');
      const again = await suppliers.findOrCreateByName('abc co.');

      expect(again.id).toBe(first.id);
      expect(first.name).toBe('ABC Co.');
      expect(await db.query(`SELECT 1 FROM suppliers`)).toHaveLength(1);
    });

    it('should treat % and _ in a name as literal text', async () => {
      await suppliers.findOrCreateByName('100X Supply');
      const literal = await suppliers.findOrCreateByName('100% Supply');
      const underscore = await suppliers.findOrCreateByName('A_B');
      await suppliers.findOrCreateByName('AXB');

      expect(literal.name).toBe('100% Supply');
      expect(underscore.name).toBe('A_B');
      expect(await db.query(`SELECT 1 FROM suppliers`)).toHaveLength(4);
      expect((await suppliers.findAll('%')).map((s) => s.name)).toEqual([
        '100% Supply',
      ]);
    });

    it('should search, list active, update and delete', async () => {
      const acme = await suppliers.create({
        name: 'Acme',
        phone: '012',
        paymentTermsDays: 30,
      });
      await suppliers.create({ name: 'Beta', active: false });

      expect((await suppliers.findAll('cm')).map((s) => s.name)).toEqual([
        'Acme',
      ]);
      expect((await suppliers.findActive()).map((s) => s.name)).toEqual([
        'Acme',
      ]);

      await suppliers.update(acme.id, { phone: '099', active: false });
      expect(await suppliers.findById(acme.id)).toMatchObject({
        phone: '099',
        active: false,
        paymentTermsDays: 30,
      });

      await suppliers.remove(acme.id);
      await expect(suppliers.findById(acme.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('NotificationsService', () => {
    let notifications: NotificationsService;
    beforeEach(() => (notifications = app.get(NotificationsService)));

    const rows = () =>
      db.query(
        `SELECT user_id, event, payload, telegram_sent, read FROM notifications ORDER BY user_id`,
      );

    it('should reach active managers and admins only, not inactive or deleted ones', async () => {
      await db.query(`
        INSERT INTO "user" (email, "roleId", active) VALUES ('off@x', 2, false);
        INSERT INTO "user" (email, "roleId", active, "deletedAt") VALUES ('gone@x', 2, true, now());
      `);

      await notifications.notify('stock_below_reorder', {
        sku: 'SKU-A',
        balance_after: '4.0000',
        skipped: undefined,
      });

      const sent = await rows();
      expect(sent.map((r) => r.user_id)).toEqual([
        world.admin.id,
        world.manager.id,
      ]);
      expect(sent[0]).toMatchObject({
        event: 'stock_below_reorder',
        payload: { sku: 'SKU-A', balance_after: '4.0000' },
        telegram_sent: false,
        read: false,
      });
    });

    it('should send named recipients over Telegram as a string chat id and mark it sent', async () => {
      await db.query(
        `UPDATE "user" SET telegram_id = 7123456789012 WHERE id = $1`,
        [world.employee.id],
      );
      telegramStub.isConfigured = true;
      telegramStub.send.mockResolvedValue(42);

      await notifications.notify('claim_confirmed', {
        recipientIds: [Number(world.employee.id), Number(world.finance.id)],
        item: 'A4 paper',
      });

      expect(telegramStub.send).toHaveBeenCalledTimes(1); // finance has no Telegram
      expect(telegramStub.send.mock.calls[0][0].chatId).toBe('7123456789012');

      const sent = await rows();
      expect(sent.map((r) => [r.user_id, r.telegram_sent])).toEqual([
        [world.finance.id, false],
        [world.employee.id, true],
      ]);
    });

    it('should mark only that user’s notifications read', async () => {
      await notifications.notify('stock_below_reorder', { sku: 'X' });
      await notifications.markAllRead(Number(world.manager.id));

      const sent = await rows();
      expect(sent.map((r) => [r.user_id, r.read])).toEqual([
        [world.admin.id, false],
        [world.manager.id, true],
      ]);
    });

    it('should never throw at the caller', async () => {
      telegramStub.isConfigured = true;
      telegramStub.send.mockRejectedValue(new Error('Bot API down'));
      await db.query(`UPDATE "user" SET telegram_id = 1 WHERE id = $1`, [
        world.manager.id,
      ]);

      await expect(
        notifications.notify('stock_below_reorder', { sku: 'X' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('Telegram webhook', () => {
    it('should process an update once and report the retry as a duplicate', async () => {
      const controller = app.get(TelegramController);
      const update = {
        update_id: 900000000001,
        message: { text: 'hello' },
      } as never;

      await expect(controller.webhook(update)).resolves.toMatchObject({
        ok: true,
      });
      await expect(controller.webhook(update)).resolves.toEqual({
        ok: true,
        duplicate: true,
      });

      const logged = await db.query(`SELECT update_id FROM telegram_updates`);
      expect(logged).toEqual([{ update_id: '900000000001' }]);
    });
  });

  describe('FileRelationalRepository', () => {
    it('should store files with a generated id and find them back', async () => {
      const files = app.get(FileRelationalRepository);

      const a = await files.create({ path: '/uploads/a.png' } as never);
      const b = await files.create({ path: '/uploads/b.png' } as never);

      expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await files.findById(a.id)).toMatchObject({
        id: a.id,
        path: '/uploads/a.png',
      });
      expect(
        (await files.findByIds([a.id, b.id])).map((f) => f.path).sort(),
      ).toEqual(['/uploads/a.png', '/uploads/b.png']);
      expect(await files.findByIds([])).toEqual([]);
      expect(
        await files.findById('00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });
});
