import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { SupplierEntity } from './entities/supplier.entity';

/** C4: the supplier master that replaces purchase_orders.supplier free text. */
@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly repository: Repository<SupplierEntity>,
  ) {}

  findAll(search?: string): Promise<SupplierEntity[]> {
    return this.repository.find({
      where: search ? { name: ILike(`%${search}%`) } : {},
      order: { name: 'ASC' },
    });
  }

  findActive(): Promise<SupplierEntity[]> {
    return this.repository.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<SupplierEntity> {
    const supplier = await this.repository.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  /**
   * Create-on-the-fly from the PO form: an exact (trimmed, case-insensitive) name match
   * reuses the existing supplier rather than minting "ABC Co." alongside "ABC Co".
   */
  async findOrCreateByName(rawName: string): Promise<SupplierEntity> {
    const name = rawName.trim();

    const existing = await this.repository.findOne({
      where: { name: ILike(name) },
    });
    if (existing) return existing;

    return this.repository.save(this.repository.create({ name }));
  }

  create(data: Partial<SupplierEntity>): Promise<SupplierEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async update(id: number, data: Partial<SupplierEntity>): Promise<void> {
    await this.repository.update(id, data);
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
  }
}
