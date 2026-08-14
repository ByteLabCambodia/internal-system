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
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { SuppliersService } from './suppliers.service';
import { ActivityService } from '../activity/activity.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';

export class SupplierFormDto {
  @IsString()
  @IsNotEmpty({ message: 'A supplier needs a name' })
  name: string;

  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @IsString() note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Payment terms must be a whole number of days' })
  paymentTermsDays?: number;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}

// C4: supplier master CRUD. manager/finance/admin, per the added `suppliers.manage`.
@Controller('admin/suppliers')
export class SuppliersController {
  constructor(
    private readonly service: SuppliersService,
    private readonly activity: ActivityService,
  ) {}

  @RequirePermission(PermissionEnum['suppliers.manage'])
  @Get()
  async list(@Res() response: Response) {
    return response.render('org/suppliers', {
      title: 'Suppliers',
      rows: await this.service.findAll(),
      values: {},
      errors: {},
      editing: null,
    });
  }

  @RequirePermission(PermissionEnum['suppliers.manage'])
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const editing = await this.service.findById(id);

    return response.render('org/suppliers', {
      title: 'Suppliers',
      rows: await this.service.findAll(),
      values: editing,
      errors: {},
      editing,
    });
  }

  @RequirePermission(PermissionEnum['suppliers.manage'])
  @Post()
  async create(@Body() body: SupplierFormDto, @Res() response: Response) {
    const form = await validateForm(SupplierFormDto, body);

    if (!form.ok) {
      return response.status(422).render('org/suppliers', {
        title: 'Suppliers',
        rows: await this.service.findAll(),
        values: body,
        errors: form.errors,
        editing: null,
      });
    }

    const supplier = await this.service.create({
      ...form.data,
      active: form.data.active !== 'false',
    });

    await this.activity.log({
      entityType: 'supplier',
      entityId: supplier.id,
      action: 'created',
      actorId: Number(response.locals.currentUser.id),
      detail: { name: supplier.name },
    });

    setFlash(response, 'success', `${supplier.name} added.`);
    return response.redirect('/admin/suppliers');
  }

  @RequirePermission(PermissionEnum['suppliers.manage'])
  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SupplierFormDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(SupplierFormDto, body);

    if (!form.ok) {
      return response.status(422).render('org/suppliers', {
        title: 'Suppliers',
        rows: await this.service.findAll(),
        values: { ...body, id },
        errors: form.errors,
        editing: { id },
      });
    }

    await this.service.update(id, {
      ...form.data,
      active: form.data.active !== 'false',
    });

    await this.activity.log({
      entityType: 'supplier',
      entityId: id,
      action: 'updated',
      actorId: Number(response.locals.currentUser.id),
    });

    setFlash(response, 'success', 'Supplier updated.');
    return response.redirect('/admin/suppliers');
  }

  @RequirePermission(PermissionEnum['suppliers.manage'])
  @Post(':id/delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.remove(id);
      setFlash(response, 'success', 'Supplier deleted.');
    } catch {
      // An FK from a purchase order means the supplier has history worth keeping.
      setFlash(
        response,
        'error',
        'This supplier is used by existing purchase orders. Deactivate it instead.',
      );
    }

    return response.redirect('/admin/suppliers');
  }
}
