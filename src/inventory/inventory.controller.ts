import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InventoryService } from './inventory.service';
import { CategoriesService } from './categories.service';
import { InventoryItemDto } from './dto/inventory-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CategoryDto } from './dto/category.dto';
import { AccountsService } from '../accounting/accounts.service';
import { ActivityService } from '../activity/activity.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { csvResponse } from '../common/web/csv';
import { buildBaseQuery } from '../procurement/purchase-requests.controller';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly categories: CategoriesService,
    private readonly accounts: AccountsService,
    private readonly activity: ActivityService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    return {
      search: query.search || undefined,
      lowStock: query.lowStock === 'true',
      page: Math.max(1, Number(query.page) || 1),
      limit: 20,
      orderBy: query.orderBy,
      order: (query.order === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
    };
  }

  // The catalog is readable by everyone; only the write routes are gated.
  @Get()
  async list(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = this.parseFilters(query);
    const { rows, count } = await this.service.list(filters);

    return response.render('inventory/item-list', {
      title: 'Inventory',
      primaryAction: response.locals.can['inventory.manage']
        ? { href: '/inventory/new', label: 'New item' }
        : null,
      rows,
      count,
      filters,
      baseQuery: buildBaseQuery(query, ['page', 'orderBy', 'order']),
      sortQuery: buildBaseQuery(query, ['orderBy', 'order']),
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const { rows } = await this.service.list({
      ...this.parseFilters(query),
      page: 1,
      limit: 10_000,
    });

    return csvResponse(
      response,
      'inventory.csv',
      [
        'SKU',
        'Name',
        'Category',
        'Unit',
        'Stock',
        'Reorder point',
        'Reorder qty',
        'Active',
      ],
      rows.map((row) => [
        row.sku,
        row.name,
        row.category ?? '',
        row.unit,
        row.stockQty,
        row.reorderPoint,
        row.reorderQty,
        row.active,
      ]),
    );
  }

  // --- categories (C1: each carries the expense account its spend debits) --------------
  @RequirePermission(PermissionEnum['inventory.manage'])
  @Get('categories')
  async categoryList(@Res() response: Response) {
    return response.render('inventory/categories', {
      title: 'Categories',
      rows: await this.categories.findAll(),
      expenseAccounts: await this.accounts.findExpenseAccounts(),
      values: {},
      errors: {},
      editing: null,
    });
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Get('categories/:id/edit')
  async categoryEdit(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const editing = await this.categories.findById(id);

    return response.render('inventory/categories', {
      title: 'Categories',
      rows: await this.categories.findAll(),
      expenseAccounts: await this.accounts.findExpenseAccounts(),
      values: {
        ...editing,
        expenseAccountId: editing.expenseAccount?.id,
      },
      errors: {},
      editing,
    });
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post('categories')
  async categoryCreate(@Body() body: CategoryDto, @Res() response: Response) {
    const form = await validateForm(CategoryDto, body);

    if (!form.ok) {
      return response.status(422).render('inventory/categories', {
        title: 'Categories',
        rows: await this.categories.findAll(),
        expenseAccounts: await this.accounts.findExpenseAccounts(),
        values: body,
        errors: form.errors,
        editing: null,
      });
    }

    await this.categories.create(form.data);
    setFlash(response, 'success', `${form.data.name} added.`);

    return response.redirect('/inventory/categories');
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post('categories/:id')
  async categoryUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CategoryDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(CategoryDto, body);

    if (!form.ok) {
      return response.status(422).render('inventory/categories', {
        title: 'Categories',
        rows: await this.categories.findAll(),
        expenseAccounts: await this.accounts.findExpenseAccounts(),
        values: { ...body, id },
        errors: form.errors,
        editing: { id },
      });
    }

    await this.categories.update(id, form.data);
    setFlash(response, 'success', 'Category updated.');

    return response.redirect('/inventory/categories');
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post('categories/:id/delete')
  async categoryDelete(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.categories.remove(id);
      setFlash(response, 'success', 'Category deleted.');
    } catch {
      setFlash(
        response,
        'error',
        'This category is referenced by existing records and cannot be deleted.',
      );
    }

    return response.redirect('/inventory/categories');
  }

  // --- items ----------------------------------------------------------------------------
  @RequirePermission(PermissionEnum['inventory.manage'])
  @Get('new')
  async newForm(@Res() response: Response) {
    return response.render('inventory/item-form', {
      title: 'New item',
      categories: await this.categories.findAll(),
      values: {},
      errors: {},
      editing: null,
    });
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post()
  async create(@Body() body: InventoryItemDto, @Res() response: Response) {
    const form = await validateForm(InventoryItemDto, body);

    const rerender = async (errors: Record<string, string>, alert?: string) =>
      response.status(422).render('inventory/item-form', {
        title: 'New item',
        categories: await this.categories.findAll(),
        values: body,
        errors,
        editing: null,
        alert,
      });

    if (!form.ok) return rerender(form.errors);

    try {
      const item = await this.service.create(
        response.locals.currentUser,
        form.data,
      );
      setFlash(response, 'success', `${item.sku} added to the catalog.`);
      return response.redirect(`/inventory/${item.id}`);
    } catch (error) {
      return rerender({}, (error as Error).message);
    }
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const item = await this.service.findById(id);

    return response.render('inventory/item-detail', {
      title: item.sku,
      item,
      movements: await this.service.movementsFor(id),
      events: await this.activity.timelineFor('inventory_item', id),
    });
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Get(':id/edit')
  async editForm(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const item = await this.service.findById(id);

    return response.render('inventory/item-form', {
      title: `Edit ${item.sku}`,
      categories: await this.categories.findAll(),
      values: item,
      errors: {},
      editing: item,
    });
  }

  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: InventoryItemDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(InventoryItemDto, body);

    if (!form.ok) {
      return response.status(422).render('inventory/item-form', {
        title: 'Edit item',
        categories: await this.categories.findAll(),
        values: { ...body, id },
        errors: form.errors,
        editing: { id },
      });
    }

    await this.service.update(response.locals.currentUser, id, form.data);
    setFlash(response, 'success', 'Item updated.');

    return response.redirect(`/inventory/${id}`);
  }

  /** Manual adjustment — the only way stock moves outside the triggers. */
  @RequirePermission(PermissionEnum['inventory.manage'])
  @Post(':id/adjust')
  async adjust(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdjustStockDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(AdjustStockDto, body);

    if (!form.ok) {
      setFlash(response, 'error', Object.values(form.errors)[0]);
      return response.redirect(`/inventory/${id}`);
    }

    try {
      const balance = await this.service.adjustStock(
        response.locals.currentUser,
        id,
        String(form.data.delta),
        form.data.note,
      );
      setFlash(response, 'success', `Stock adjusted. New balance: ${balance}.`);
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/inventory/${id}`);
  }
}
