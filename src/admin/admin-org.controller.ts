import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { OrgService } from '../org/org.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';

export class OrgFormDto {
  @IsIn(['department', 'project'])
  kind: 'department' | 'project';

  @IsString()
  @IsNotEmpty({ message: 'A name is required' })
  name: string;
}

/** Departments and projects: the dimensions carried on PRs, POs and journal lines. */
@RequirePermission(PermissionEnum['users.manage'])
@Controller('admin/org')
export class AdminOrgController {
  constructor(private readonly org: OrgService) {}

  private async render(
    response: Response,
    extra: Record<string, unknown> = {},
  ) {
    return response.render('admin/org', {
      title: 'Departments & projects',
      departments: await this.org.findAllDepartments(),
      projects: await this.org.findAllProjects(),
      values: {},
      errors: {},
      ...extra,
    });
  }

  @Get()
  list(@Res() response: Response) {
    return this.render(response);
  }

  @Post()
  async create(@Body() body: OrgFormDto, @Res() response: Response) {
    const form = await validateForm(OrgFormDto, body);

    if (!form.ok) {
      return this.render(response, { values: body, errors: form.errors });
    }

    await this.org.create(form.data.kind, form.data.name);
    setFlash(response, 'success', `${form.data.name} added.`);

    return response.redirect('/admin/org');
  }

  @Post(':kind/:id/rename')
  async rename(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @Res() response: Response,
  ) {
    if (kind !== 'department' && kind !== 'project') {
      setFlash(response, 'error', 'Unknown record type.');
      return response.redirect('/admin/org');
    }

    if (!name?.trim()) {
      setFlash(response, 'error', 'A name is required.');
      return response.redirect('/admin/org');
    }

    await this.org.rename(kind, id, name);
    setFlash(response, 'success', 'Renamed.');

    return response.redirect('/admin/org');
  }

  @Post(':kind/:id/toggle')
  async toggle(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    if (kind !== 'department' && kind !== 'project') {
      setFlash(response, 'error', 'Unknown record type.');
      return response.redirect('/admin/org');
    }

    await this.org.toggleActive(kind, id);
    setFlash(response, 'success', 'Updated.');

    return response.redirect('/admin/org');
  }

  @Post(':kind/:id/delete')
  async remove(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    if (kind !== 'department' && kind !== 'project') {
      setFlash(response, 'error', 'Unknown record type.');
      return response.redirect('/admin/org');
    }

    try {
      await this.org.remove(kind, id);
      setFlash(response, 'success', 'Deleted.');
    } catch {
      // Referenced by a PR, PO or journal line — deactivating keeps the history readable.
      setFlash(
        response,
        'error',
        'This is used by existing records and cannot be deleted. Deactivate it instead.',
      );
    }

    return response.redirect('/admin/org');
  }
}
