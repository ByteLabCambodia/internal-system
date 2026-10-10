import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryDto } from './dto/category.dto';

/** C1: categories carry the expense account their spend debits. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private get categories() {
    return this.prisma.db.orm.public.Category;
  }

  async findAll() {
    return await this.categories
      .include('expenseAccount')
      .orderBy((c) => c.name.asc())
      .all();
  }

  async findById(id: number) {
    const category = await this.categories
      .where({ id })
      .include('expenseAccount')
      .first();

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CategoryDto) {
    return await this.categories.create(this.fields(dto));
  }

  async update(id: number, dto: CategoryDto): Promise<void> {
    await this.categories.where({ id }).update(this.fields(dto));
  }

  async remove(id: number): Promise<void> {
    await this.categories.where({ id }).delete();
  }

  private fields(dto: CategoryDto) {
    return {
      name: dto.name.trim(),
      description: dto.description ?? null,
      expenseAccountId: dto.expenseAccountId || null,
    };
  }
}
