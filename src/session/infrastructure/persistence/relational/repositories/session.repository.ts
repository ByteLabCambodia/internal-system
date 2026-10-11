import { Injectable } from '@nestjs/common';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { SessionRepository } from '../../session.repository';
import { Session } from '../../../../domain/session';
import { SessionMapper } from '../mappers/session.mapper';
import { User } from '../../../../../users/domain/user';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { toTimestamp } from '../../../../../prisma/dates';
import { timestamp } from '../../../../../prisma/numeric';

@Injectable()
export class SessionRelationalRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get sessions() {
    return this.prisma.db.orm.public.Session;
  }

  private now() {
    return timestamp(toTimestamp(new Date()));
  }

  async findById(id: Session['id']): Promise<NullableType<Session>> {
    const row = await this.sessions
      .include('user', (user) => user.include('role').include('photo'))
      .where({ id: Number(id) })
      .where((s) => s.deletedAt.isNull())
      .first();

    return row ? SessionMapper.toDomain(row) : null;
  }

  async create(data: Session): Promise<Session> {
    const row = await this.sessions.create({
      hash: data.hash,
      userId: Number(data.user.id),
    });
    return (await this.findById(row.id))!;
  }

  async update(
    id: Session['id'],
    payload: Partial<
      Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
    >,
  ): Promise<Session | null> {
    if (!(await this.findById(id))) {
      throw new Error('Session not found');
    }

    await this.sessions.where({ id: Number(id) }).update({
      ...(payload.hash !== undefined ? { hash: payload.hash } : {}),
      ...(payload.user ? { userId: Number(payload.user.id) } : {}),
      updatedAt: this.now(),
    });

    return this.findById(id);
  }

  async updateByHash(
    conditions: { id: Session['id']; hash: Session['hash'] },
    payload: Partial<
      Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
    >,
  ): Promise<Session | null> {
    const updated = await this.sessions
      .where({ id: Number(conditions.id), hash: conditions.hash })
      .where((s) => s.deletedAt.isNull())
      .update({ hash: payload.hash, updatedAt: this.now() });

    return updated ? this.findById(conditions.id) : null;
  }

  async deleteById(id: Session['id']): Promise<void> {
    await this.sessions
      .where({ id: Number(id) })
      .where((s) => s.deletedAt.isNull())
      .updateAll({ deletedAt: this.now() });
  }

  async deleteByUserId(conditions: { userId: User['id'] }): Promise<void> {
    await this.sessions
      .where({ userId: Number(conditions.userId) })
      .where((s) => s.deletedAt.isNull())
      .updateAll({ deletedAt: this.now() });
  }

  async deleteByUserIdWithExclude(conditions: {
    userId: User['id'];
    excludeSessionId: Session['id'];
  }): Promise<void> {
    await this.sessions
      .where({ userId: Number(conditions.userId) })
      .where((s) => s.id.neq(Number(conditions.excludeSessionId)))
      .where((s) => s.deletedAt.isNull())
      .updateAll({ deletedAt: this.now() });
  }
}
