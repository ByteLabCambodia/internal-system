import { Injectable } from '@nestjs/common';
import { RoleEnum } from '../roles/roles.enum';
import { PermissionEnum } from './permissions.enum';
import { PERMISSION_MATRIX, PRIVILEGED_ROLES } from './permissions.matrix';

export type Actor = {
  id: number | string;
  role?: { id: number | string } | null;
};

@Injectable()
export class PermissionsService {
  roleOf(actor?: Actor | null): RoleEnum | null {
    const id = actor?.role?.id;
    if (id === undefined || id === null) return null;

    const role = Number(id) as RoleEnum;
    return RoleEnum[role] ? role : null;
  }

  can(actor: Actor | null | undefined, permission: PermissionEnum): boolean {
    const role = this.roleOf(actor);
    if (!role) return false;

    return PERMISSION_MATRIX[permission].includes(role);
  }

  /**
   * Whether this actor sees every row of an owned resource (purchase requests, stock
   * requests, claims, purchase orders) or only their own. Apply the result in the
   * repository query — never in the template. A missing scope here is a data leak.
   */
  seesAllRows(actor?: Actor | null): boolean {
    const role = this.roleOf(actor);
    return role !== null && PRIVILEGED_ROLES.includes(role);
  }

  /** Every permission this actor holds — used to drive nav and button visibility. */
  grantsFor(actor?: Actor | null): Record<string, boolean> {
    const grants: Record<string, boolean> = {};

    for (const permission of Object.values(PermissionEnum)) {
      grants[permission] = this.can(actor, permission);
    }

    return grants;
  }
}
