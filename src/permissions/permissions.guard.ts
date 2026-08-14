import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionEnum } from './permissions.enum';
import { PermissionsService } from './permissions.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionEnum[]>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const actor = request.user;

    const missing = required.filter(
      (permission) => !this.permissions.can(actor, permission),
    );

    if (missing.length) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }

    return true;
  }
}
