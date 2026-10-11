import { TestingModule } from '@nestjs/testing';
import { createTestApp, resetData } from './support/test-app';
import { TestDb } from './support/test-db';
import { q, seedRoles, seedWorld, World } from './support/fixtures';
import { SettingsService } from '../../src/settings/settings.service';
import { ActivityService } from '../../src/activity/activity.service';

describe('SettingsService and ActivityService', () => {
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
  });

  describe('settings', () => {
    let settings: SettingsService;
    beforeEach(() => (settings = app.get(SettingsService)));

    it('should fall back when a setting is missing', async () => {
      expect(await settings.get('nope', 'dflt')).toBe('dflt');
      expect((await settings.numeric('nope', '0.5')).toString()).toBe('0.5');
    });

    it('should insert, then update in place and stamp updated_at', async () => {
      await settings.set('receipt_tolerance_pct', '0.05');
      await db.query(
        `UPDATE app_settings SET updated_at = now() - interval '1 day' WHERE key = 'receipt_tolerance_pct'`,
      );

      await settings.set('receipt_tolerance_pct', '0.1');

      const rows = await db.query(`SELECT * FROM app_settings`);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('0.1');
      const fresh = await q(
        db,
        `SELECT updated_at > now() - interval '1 minute' AS fresh FROM app_settings`,
      );
      expect(fresh.fresh).toBe(true);
      expect((await settings.numeric('receipt_tolerance_pct')).toString()).toBe(
        '0.1',
      );
    });

    it('should treat a blank or garbage numeric setting as the fallback', async () => {
      await settings.set('payment_tolerance_pct', '  ');
      expect((await settings.numeric('payment_tolerance_pct')).toString()).toBe(
        '0',
      );
      await settings.set('payment_tolerance_pct', 'abc');
      expect(
        (await settings.numeric('payment_tolerance_pct', 1)).toString(),
      ).toBe('1');
    });

    it('should list settings by key', async () => {
      await settings.set('b', '2');
      await settings.set('a', '1');
      expect((await settings.findAll()).map((s) => s.key)).toEqual(['a', 'b']);
    });
  });

  describe('activity', () => {
    let activity: ActivityService;
    beforeEach(() => (activity = app.get(ActivityService)));

    it('should record events and return a timeline oldest first with actor names', async () => {
      await activity.log({
        entityType: 'stock_request',
        entityId: 7,
        action: 'created',
        actorId: Number(world.employee.id),
        detail: { qty: 2, skipped: undefined },
      });
      await activity.log({
        entityType: 'stock_request',
        entityId: 7,
        action: 'approved',
      });
      await activity.log({
        entityType: 'stock_request',
        entityId: 8,
        action: 'created',
      });

      const timeline = await activity.timelineFor('stock_request', 7);

      expect(timeline.map((t) => [t.action, t.actorName])).toEqual([
        ['created', 'employee Test'],
        ['approved', null],
      ]);
      expect(timeline[0].createdAt).toBeInstanceOf(Date);

      const row = await q(
        db,
        `SELECT detail FROM activity_events WHERE action = 'created' AND entity_id = 7`,
      );
      expect(row.detail).toEqual({ qty: 2 });
    });

    it('should swallow failures instead of breaking the caller', async () => {
      await expect(
        activity.log({
          entityType: 'user',
          entityId: 1,
          action: 'x',
          actorId: 999999,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
