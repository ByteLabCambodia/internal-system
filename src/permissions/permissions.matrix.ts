import { RoleEnum } from '../roles/roles.enum';
import { PermissionEnum } from './permissions.enum';

const { employee, manager, finance, admin } = RoleEnum;

/**
 * Part 1 §1 of NESTJS_MIGRATION_BRIEF.md, transcribed row for row. This is the single
 * source of truth for "who may attempt what" — do not spell out role checks anywhere else.
 *
 * Note what this does NOT cover: `pr.decide` gates who may attempt a decision, while the
 * approval_thresholds amount tier (C2) gates which decisions succeed, and the self-approval
 * block is trigger T6. Row visibility is separate again — see PermissionsService.
 */
export const PERMISSION_MATRIX: Record<PermissionEnum, RoleEnum[]> = {
  [PermissionEnum['pr.create']]: [employee, manager, finance, admin],
  [PermissionEnum['pr.decide']]: [manager, admin],
  [PermissionEnum['pr.cancel']]: [manager, finance, admin],
  [PermissionEnum['po.create']]: [manager, finance, admin],
  [PermissionEnum['po.cancel']]: [manager, finance, admin],
  [PermissionEnum['payment.record']]: [finance, admin],
  [PermissionEnum['claim.submit']]: [employee, manager, finance, admin],
  [PermissionEnum['claim.confirm']]: [manager, admin],
  [PermissionEnum['stock.request']]: [employee, manager, finance, admin],
  [PermissionEnum['stock.fulfil']]: [manager, admin],
  [PermissionEnum['inventory.manage']]: [manager, admin],
  [PermissionEnum['accounting.view']]: [manager, finance, admin],
  [PermissionEnum['income.add']]: [finance, admin],
  [PermissionEnum['rate.override']]: [finance, admin],
  [PermissionEnum['users.manage']]: [admin],
  // C4
  [PermissionEnum['suppliers.manage']]: [manager, finance, admin],
};

/** Roles that see every row rather than only their own. */
export const PRIVILEGED_ROLES: RoleEnum[] = [manager, finance, admin];
