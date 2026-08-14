import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';

@RequirePermission(PermissionEnum['users.manage'])
@Controller('admin')
export class AdminController {
  @Get()
  index(@Res() response: Response) {
    return response.redirect('/admin/users');
  }
}
