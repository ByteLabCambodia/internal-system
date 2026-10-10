import { TestDb } from './test-db';
import { RoleEnum } from '../../../src/roles/roles.enum';
import { User } from '../../../src/users/domain/user';

/**
 * Fixtures are plain SQL on purpose: they must keep working unchanged when the services
 * move off triggers and, later, off TypeORM.
 */
export type World = {
  admin: User;
  manager: User;
  finance: User;
  employee: User;
  accounts: { cash: number; misc: number; supplies: number };
  departmentId: number;
  projectId: number;
  itemA: number;
  itemB: number;
};

async function one<T = Record<string, any>>(
  db: TestDb,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await db.query(sql, params);
  return rows[0] as T;
}

export async function seedRoles(db: TestDb): Promise<void> {
  await db.query(`
    INSERT INTO "role" (id, name) VALUES
      (1, 'Admin'), (2, 'Manager'), (3, 'Finance'), (4, 'Employee')
    ON CONFLICT (id) DO NOTHING
  `);
}

async function user(db: TestDb, role: RoleEnum, name: string): Promise<User> {
  const row = await one(
    db,
    `INSERT INTO "user" (email, "firstName", "lastName", "roleId", active)
     VALUES ($1, $2, 'Test', $3, true) RETURNING id`,
    [`${name}@test.local`, name, role],
  );
  return { id: row.id, role: { id: role } } as User;
}

export async function seedWorld(db: TestDb): Promise<World> {
  const admin = await user(db, RoleEnum.admin, 'admin');
  const manager = await user(db, RoleEnum.manager, 'manager');
  const finance = await user(db, RoleEnum.finance, 'finance');
  const employee = await user(db, RoleEnum.employee, 'employee');

  const account = async (code: string, name: string, type: string) =>
    (
      await one(
        db,
        `INSERT INTO accounts (code, name, type) VALUES ($1, $2, $3) RETURNING id`,
        [code, name, type],
      )
    ).id as number;

  const cash = await account('1000', 'Cash', 'asset');
  const misc = await account('6900', 'Miscellaneous expense', 'expense');
  const supplies = await account('6100', 'Office supplies', 'expense');

  const departmentId = (
    await one(db, `INSERT INTO departments (name) VALUES ('Ops') RETURNING id`)
  ).id;
  const projectId = (
    await one(db, `INSERT INTO projects (name) VALUES ('Fit-out') RETURNING id`)
  ).id;

  await db.query(
    `INSERT INTO exchange_rates (rate_date, currency, rate_to_usd) VALUES (current_date, 'KHR', 4000)`,
  );

  const item = async (
    sku: string,
    stock: string,
    reorderPoint = '0',
    reorderQty = '0',
  ) =>
    (
      await one(
        db,
        `INSERT INTO inventory_items (sku, name, category, stock_qty, reorder_point, reorder_qty)
         VALUES ($1, $2, 'Supplies', $3, $4, $5) RETURNING id`,
        [sku, `Item ${sku}`, stock, reorderPoint, reorderQty],
      )
    ).id as number;

  const itemA = await item('SKU-A', '10');
  const itemB = await item('SKU-B', '0');

  return {
    admin,
    manager,
    finance,
    employee,
    accounts: { cash, misc, supplies },
    departmentId,
    projectId,
    itemA,
    itemB,
  };
}

export type PoFixture = { poId: number; poNumber: string; lineIds: number[] };

/**
 * A USD purchase order (so total_usd = total_original). `lines` are
 * [inventoryItemId, qtyOrdered, unitPrice].
 */
export async function seedPurchaseOrder(
  db: TestDb,
  world: World,
  opts: {
    lines: [number | null, string, string][];
    expenseAccountId?: number | null;
    status?: string;
  },
): Promise<PoFixture> {
  const total = opts.lines
    .reduce((sum, [, qty, price]) => sum + Number(qty) * Number(price), 0)
    .toFixed(4);

  const po = await one(
    db,
    `INSERT INTO purchase_orders
       (supplier, currency, exchange_rate, total_original, total_usd, status,
        expense_account_id, department_id, project_id, created_by)
     VALUES ('Acme', 'USD', 1, $1, $1, $2, $3, $4, $5, $6)
     RETURNING id, po_number`,
    [
      total,
      opts.status ?? 'open',
      opts.expenseAccountId ?? null,
      world.departmentId,
      world.projectId,
      world.manager.id,
    ],
  );

  const lineIds: number[] = [];
  for (const [itemId, qty, price] of opts.lines) {
    const line = await one(
      db,
      `INSERT INTO purchase_order_items (po_id, inventory_item_id, name, qty_ordered, unit_price_original)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [po.id, itemId, `Line ${lineIds.length + 1}`, qty, price],
    );
    lineIds.push(line.id);
  }

  return { poId: po.id, poNumber: po.po_number, lineIds };
}

export async function setSetting(
  db: TestDb,
  key: string,
  value: string,
): Promise<void> {
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function seedStockRequest(
  db: TestDb,
  requester: User,
  itemId: number,
  qty: string,
  status = 'approved',
): Promise<number> {
  return (
    await one(
      db,
      `INSERT INTO stock_requests (requester_id, inventory_item_id, qty, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [requester.id, itemId, qty, status],
    )
  ).id;
}

export const q = one;

/**
 * Forces a race. A separate connection locks `lockSql`'s rows, the racers start, and the
 * lock is released only once every racer is blocked on a lock inside its transaction.
 * Without this, one racer usually finishes before the other starts, and a missing
 * `FOR UPDATE` in the workflow would go unnoticed.
 */
export async function raceBehindLock<T>(
  db: TestDb,
  lockSql: string,
  params: unknown[],
  racers: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const gate = await db.connect();
  let open = false;
  try {
    await gate.query('BEGIN');
    open = true;
    await gate.query(lockSql, params);
    const settled = Promise.allSettled(racers.map((race) => race()));

    for (let attempt = 0; ; attempt++) {
      const [{ blocked }] = await db.query(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (blocked >= racers.length) break;
      if (attempt === 250) throw new Error('the racers never blocked');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await gate.query('COMMIT');
    open = false;
    return await settled;
  } finally {
    if (open) await gate.query('ROLLBACK');
    gate.release();
  }
}
