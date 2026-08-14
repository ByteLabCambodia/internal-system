import { SetMetadata } from '@nestjs/common';
import { PermissionEnum } from './permissions.enum';

export const REQUIRE_PERMISSION_KEY = 'requiredPermissions';

/** Route needs every listed permission. See PERMISSION_MATRIX for who holds what. */
export const RequirePermission = (...permissions: PermissionEnum[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
