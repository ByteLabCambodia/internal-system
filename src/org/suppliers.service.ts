import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { contains, escapeLike } from '../prisma/like';

export type SupplierInput = {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  bankAccount?: string | null;
  paymentTermsDays?: number | null;
  note?: string | null;
  active?: boolean;
};

/** C4: the supplier master that replaces purchase_orders.supplier free text. */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  private get suppliers() {
    return this.prisma.db.orm.public.Supplier;
  }

  async findAll(search?: string) {
    const query = search
      ? this.suppliers.where((s) => s.name.ilike(contains(search)))
      : this.suppliers;
    return await query.orderBy((s) => s.name.asc()).all();
  }

  async findActive() {
    return await this.suppliers
      .where({ active: true })
      .orderBy((s) => s.name.asc())
      .all();
  }

  async findById(id: number) {
    const supplier = await this.suppliers.where({ id }).first();
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  /**
   * Create-on-the-fly from the PO form: an exact (trimmed, case-insensitive) name match
   * reuses the existing supplier rather than minting "ABC Co." alongside "ABC Co".
   */
  async findOrCreateByName(rawName: string) {
    const name = rawName.trim();

    const existing = await this.suppliers
      .where((s) => s.name.ilike(escapeLike(name)))
      .first();
    if (existing) return existing;

    return await this.suppliers.create({ name });
  }

  async create(data: SupplierInput & { name: string }) {
    return await this.suppliers.create(data);
  }

  async update(id: number, data: SupplierInput): Promise<void> {
    await this.suppliers.where({ id }).update(data);
  }

  async remove(id: number): Promise<void> {
    await this.suppliers.where({ id }).delete();
  }
}
