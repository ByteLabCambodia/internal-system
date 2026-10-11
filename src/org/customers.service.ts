import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { contains } from '../prisma/like';

export type CustomerInput = {
  name?: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  note?: string | null;
  active?: boolean;
};

/** Who quotations, invoices and receipts are made out to. */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private get customers() {
    return this.prisma.db.orm.public.Customer;
  }

  async findAll(search?: string) {
    const query = search
      ? this.customers.where((s) => s.name.ilike(contains(search)))
      : this.customers;
    return await query.orderBy((s) => s.name.asc()).all();
  }

  async findActive() {
    return await this.customers
      .where({ active: true })
      .orderBy((s) => s.name.asc())
      .all();
  }

  async findById(id: number) {
    const customer = await this.customers.where({ id }).first();
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(data: CustomerInput & { name: string }) {
    return await this.customers.create(data);
  }

  async update(id: number, data: CustomerInput): Promise<void> {
    await this.customers.where({ id }).update(data);
  }

  async remove(id: number): Promise<void> {
    await this.customers.where({ id }).delete();
  }
}
