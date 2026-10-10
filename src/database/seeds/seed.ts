import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from '../../prisma/contract.d';
import contractJson from '../../prisma/contract.json';
import { databaseUrlWithSsl } from '../../prisma/database-url';
import { AccountTypeEnum } from '../../common/enums';
import { RoleEnum } from '../../roles/roles.enum';

/**
 * Reference data every environment needs, plus one login per role for development. Each
 * row is inserted only when missing, so this is safe to re-run: `pnpm run seed`.
 */

const ROLES = [
  { id: RoleEnum.admin, name: 'Admin' },
  { id: RoleEnum.manager, name: 'Manager' },
  { id: RoleEnum.finance, name: 'Finance' },
  { id: RoleEnum.employee, name: 'Employee' },
];

export const CHART_OF_ACCOUNTS: {
  code: string;
  name: string;
  type: AccountTypeEnum;
}[] = [
  { code: '1000', name: 'Cash / Bank', type: AccountTypeEnum.asset },
  { code: '2000', name: 'Accounts Payable', type: AccountTypeEnum.liability },
  { code: '3000', name: 'Owner Equity', type: AccountTypeEnum.equity },
  {
    code: '4000',
    name: 'Sales / Service Income',
    type: AccountTypeEnum.income,
  },
  {
    code: '6000',
    name: 'Office Supplies Expense',
    type: AccountTypeEnum.expense,
  },
  {
    code: '6100',
    name: 'IT / Components Expense',
    type: AccountTypeEnum.expense,
  },
  { code: '6900', name: 'Misc Expense', type: AccountTypeEnum.expense },
];

/** C1: every category maps to the GL account its spend debits. */
const CATEGORIES = [
  { name: 'Electronics', accountCode: '6100' },
  { name: 'Office Supplies', accountCode: '6000' },
  { name: 'Tools', accountCode: '6100' },
  { name: 'Materials', accountCode: '6100' },
];

/** Manager and admin are both unlimited (null): no per-role approval cap. */
const UNLIMITED_APPROVERS = [RoleEnum.manager, RoleEnum.admin];

/**
 * C3 tolerances live in the database so an admin can change them without a deploy. Both
 * default to 0; real purchasing sometimes wants 2–5%.
 */
const SETTINGS = [
  {
    key: 'receipt_tolerance_pct',
    value: '0',
    description:
      'Fraction over qty_ordered a claim may receive, e.g. 0.05 for 5%. 0 = exact.',
  },
  {
    key: 'payment_tolerance_pct',
    value: '0',
    description:
      'Fraction over the PO total_usd that payments may sum to, e.g. 0.02 for 2%. 0 = exact.',
  },
];

/** One account per role for local development. Password for all of them: "secret". */
const DEV_USERS = [
  {
    firstName: 'Super',
    lastName: 'Admin',
    email: 'admin@example.com',
    roleId: RoleEnum.admin,
  },
  {
    firstName: 'Molly',
    lastName: 'Manager',
    email: 'manager@example.com',
    roleId: RoleEnum.manager,
  },
  {
    firstName: 'Fiona',
    lastName: 'Finance',
    email: 'finance@example.com',
    roleId: RoleEnum.finance,
  },
  {
    firstName: 'Eddie',
    lastName: 'Employee',
    email: 'employee@example.com',
    roleId: RoleEnum.employee,
  },
];

function connect(env: Record<string, string | undefined>) {
  const pool = new Pool({ connectionString: databaseUrlWithSsl(env), max: 2 });
  const db = postgres<Contract>({
    contractJson,
    pg: pool,
    verifyMarker: false,
  });
  return { db, close: async () => (await db.close(), await pool.end()) };
}

type Db = ReturnType<typeof connect>['db'];

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, await bcrypt.genSalt());
}

export async function seed(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const orm = db.orm.public;

  // Roles and accounts first: everything else references them.
  for (const role of ROLES) {
    if (!(await orm.Role.where({ id: role.id }).first())) {
      await orm.Role.create(role);
    }
  }

  for (const account of CHART_OF_ACCOUNTS) {
    if (!(await orm.Account.where({ code: account.code }).first())) {
      await orm.Account.create(account);
    }
  }

  for (const category of CATEGORIES) {
    if (await orm.Category.where({ name: category.name }).first()) continue;
    const account = await orm.Account.where({
      code: category.accountCode,
    }).first();
    await orm.Category.create({
      name: category.name,
      expenseAccountId: account?.id ?? null,
    });
  }

  for (const roleId of UNLIMITED_APPROVERS) {
    if (!(await orm.ApprovalThreshold.where({ roleId }).first())) {
      await orm.ApprovalThreshold.create({ roleId, maxAmountUsd: null });
    }
  }

  for (const setting of SETTINGS) {
    if (!(await orm.AppSetting.where({ key: setting.key }).first())) {
      await orm.AppSetting.create(setting);
    }
  }

  for (const { roleId, ...user } of DEV_USERS) {
    if (await orm.User.where({ email: user.email }).first()) continue;
    await orm.User.create({
      ...user,
      roleId,
      password: await hash('secret'),
      active: true,
    });
  }

  // The first real admin, from the environment, so resetting the database does not cost
  // you your own account. Created with must_change_password, so the seeded password is
  // never the long-term one.
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (email && password && !(await orm.User.where({ email }).first())) {
    await orm.User.create({
      firstName: env.ADMIN_FIRST_NAME ?? 'Owner',
      lastName: env.ADMIN_LAST_NAME ?? 'Admin',
      email,
      password: await hash(password),
      roleId: RoleEnum.admin,
      active: true,
      mustChangePassword: true,
    });
  }
}

if (require.main === module) {
  const { db, close } = connect(process.env);
  seed(db)
    .then(close)
    .catch(async (error: unknown) => {
      console.error(error);
      await close();
      process.exit(1);
    });
}
