import { Injectable } from '@nestjs/common';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { FilterUserDto, SortUserDto } from '../../../../dto/query-user.dto';
import { User } from '../../../../domain/user';
import { UserRepository } from '../../user.repository';
import { UserMapper } from '../mappers/user.mapper';
import { IPaginationOptions } from '../../../../../utils/types/pagination-options';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { toTimestamp } from '../../../../../prisma/dates';
import { timestamp } from '../../../../../prisma/numeric';

const SORTABLE = new Set([
  'id',
  'email',
  'firstName',
  'lastName',
  'provider',
  'active',
  'department',
  'createdAt',
  'updatedAt',
]);

@Injectable()
export class UsersRelationalRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Live users with role and photo, as TypeORM's eager relations and soft delete gave. */
  private live() {
    return this.prisma.db.orm.public.User.include('role')
      .include('photo')
      .where((u) => u.deletedAt.isNull());
  }

  private now() {
    return timestamp(toTimestamp(new Date()));
  }

  async create(data: User): Promise<User> {
    const row = await this.prisma.db.orm.public.User.create({
      ...UserMapper.toWrite(data),
      provider: data.provider ?? 'email',
      active: data.active ?? true,
      mustChangePassword: data.mustChangePassword ?? false,
    });
    return (await this.findById(row.id))!;
  }

  async findManyWithPagination({
    filterOptions,
    sortOptions,
    paginationOptions,
  }: {
    filterOptions?: FilterUserDto | null;
    sortOptions?: SortUserDto[] | null;
    paginationOptions: IPaginationOptions;
  }): Promise<User[]> {
    let query = this.live();

    const roleIds = filterOptions?.roles?.map((role) => Number(role.id));
    if (roleIds?.length) {
      query = query.where((u) => u.roleId.in(roleIds));
    }

    const sorts = (sortOptions ?? []).filter((sort) =>
      SORTABLE.has(String(sort.orderBy)),
    );
    const ordered = sorts.length
      ? query.orderBy(
          sorts.map((sort) => (u) => {
            const column = u[sort.orderBy as 'id'];
            return String(sort.order).toUpperCase() === 'DESC'
              ? column.desc()
              : column.asc();
          }),
        )
      : query.orderBy((u) => u.id.asc());

    const rows = await ordered
      .offset((paginationOptions.page - 1) * paginationOptions.limit)
      .limit(paginationOptions.limit)
      .all();

    return rows.map((row) => UserMapper.toDomain(row));
  }

  async findById(id: User['id']): Promise<NullableType<User>> {
    const row = await this.live()
      .where({ id: Number(id) })
      .first();
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByIds(ids: User['id'][]): Promise<User[]> {
    if (!ids.length) return [];
    const rows = await this.live()
      .where((u) => u.id.in(ids.map(Number)))
      .all();
    return rows.map((row) => UserMapper.toDomain(row));
  }

  async findByEmail(email: User['email']): Promise<NullableType<User>> {
    if (!email) return null;
    const row = await this.live().where({ email }).first();
    return row ? UserMapper.toDomain(row) : null;
  }

  async findBySocialIdAndProvider({
    socialId,
    provider,
  }: {
    socialId: User['socialId'];
    provider: User['provider'];
  }): Promise<NullableType<User>> {
    if (!socialId || !provider) return null;
    const row = await this.live().where({ socialId, provider }).first();
    return row ? UserMapper.toDomain(row) : null;
  }

  /** Writes only the fields given; everything else keeps its stored value. */
  async update(id: User['id'], payload: Partial<User>): Promise<User> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error('User not found');
    }

    await this.prisma.db.orm.public.User.where({ id: Number(id) }).update({
      ...UserMapper.toWrite(payload),
      updatedAt: this.now(),
    });

    return (await this.findById(id))!;
  }

  async remove(id: User['id']): Promise<void> {
    await this.prisma.db.orm.public.User.where({ id: Number(id) })
      .where((u) => u.deletedAt.isNull())
      .update({ deletedAt: this.now() });
  }

  // --- admin screen ------------------------------------------------------------------

  async findAll(): Promise<User[]> {
    const rows = await this.live()
      .orderBy((u) => u.id.asc())
      .all();
    return rows.map((row) => UserMapper.toDomain(row));
  }

  async countActiveWithRole(
    roleId: number,
    excludeId?: User['id'],
  ): Promise<number> {
    let query = this.live().where({ roleId, active: true });
    if (excludeId !== undefined) {
      query = query.where((u) => u.id.neq(Number(excludeId)));
    }
    return (await query.all()).length;
  }

  /** Accounts that can never sign in: an email but no password. */
  async countWithoutPassword(): Promise<number> {
    const rows = await this.live()
      .where((u) => u.password.isNull())
      .where((u) => u.email.isNotNull())
      .all();
    return rows.length;
  }
}
