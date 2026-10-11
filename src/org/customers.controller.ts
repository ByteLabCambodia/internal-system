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
import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CustomersService } from './customers.service';
import { ActivityService } from '../activity/activity.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { lastValueTransformer } from '../utils/transformers/last-value.transformer';

export class CustomerFormDto {
  @IsString()
  @IsNotEmpty({ message: 'A customer needs a name' })
  name: string;

  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() note?: string;

  @IsOptional()
  @Transform(lastValueTransformer)
  @IsBooleanString()
  active?: string;
}

// Customer master for sales documents. manager/finance/admin, like customers.
@Controller('admin/customers')
export class CustomersController {
  constructor(
    private readonly service: CustomersService,
    private readonly activity: ActivityService,
  ) {}

  @RequirePermission(PermissionEnum['customers.manage'])
  @Get()
  async list(@Res() response: Response) {
    return response.render('org/customers', {
      title: 'Customers',
      rows: await this.service.findAll(),
      values: {},
      errors: {},
      editing: null,
    });
  }

  @RequirePermission(PermissionEnum['customers.manage'])
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const editing = await this.service.findById(id);

    return response.render('org/customers', {
      title: 'Customers',
      rows: await this.service.findAll(),
      values: editing,
      errors: {},
      editing,
    });
  }

  @RequirePermission(PermissionEnum['customers.manage'])
  @Post()
  async create(@Body() body: CustomerFormDto, @Res() response: Response) {
    const form = await validateForm(CustomerFormDto, body);

    if (!form.ok) {
      return response.status(422).render('org/customers', {
        title: 'Customers',
        rows: await this.service.findAll(),
        values: body,
        errors: form.errors,
        editing: null,
      });
    }

    const customer = await this.service.create({
      ...form.data,
      active: form.data.active !== 'false',
    });

    await this.activity.log({
      entityType: 'customer',
      entityId: customer.id,
      action: 'created',
      actorId: Number(response.locals.currentUser.id),
      detail: { name: customer.name },
    });

    setFlash(response, 'success', `${customer.name} added.`);
    return response.redirect('/admin/customers');
  }

  @RequirePermission(PermissionEnum['customers.manage'])
  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CustomerFormDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(CustomerFormDto, body);

    if (!form.ok) {
      return response.status(422).render('org/customers', {
        title: 'Customers',
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
      entityType: 'customer',
      entityId: id,
      action: 'updated',
      actorId: Number(response.locals.currentUser.id),
    });

    setFlash(response, 'success', 'Customer updated.');
    return response.redirect('/admin/customers');
  }

  @RequirePermission(PermissionEnum['customers.manage'])
  @Post(':id/delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.remove(id);
      setFlash(response, 'success', 'Customer deleted.');
    } catch {
      // An FK from a sales document means the customer has history worth keeping.
      setFlash(
        response,
        'error',
        'This customer has quotations or invoices. Deactivate it instead.',
      );
    }

    return response.redirect('/admin/customers');
  }
}
