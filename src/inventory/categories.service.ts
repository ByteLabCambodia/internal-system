import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from './entities/category.entity';
import { CategoryDto } from './dto/category.dto';

/** C1: categories carry the expense account their spend debits. */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly repository: Repository<CategoryEntity>,
  ) {}

  findAll(): Promise<CategoryEntity[]> {
    return this.repository.find({
      relations: ['expenseAccount'],
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<CategoryEntity> {
    const category = await this.repository.findOne({
      where: { id },
      relations: ['expenseAccount'],
    });

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  create(dto: CategoryDto): Promise<CategoryEntity> {
    return this.repository.save(
      this.repository.create({
        name: dto.name.trim(),
        description: dto.description ?? null,
        expenseAccount: dto.expenseAccountId
          ? ({ id: dto.expenseAccountId } as never)
          : null,
      }),
    );
  }

  async update(id: number, dto: CategoryDto): Promise<void> {
    await this.repository.update(id, {
      name: dto.name.trim(),
      description: dto.description ?? null,
      expenseAccount: dto.expenseAccountId
        ? ({ id: dto.expenseAccountId } as never)
        : null,
    });
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
  }
}
