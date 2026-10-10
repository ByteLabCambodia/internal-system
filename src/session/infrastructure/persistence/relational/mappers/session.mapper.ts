import {
  UserMapper,
  UserRow,
} from '../../../../../users/infrastructure/persistence/relational/mappers/user.mapper';
import { Session } from '../../../../domain/session';
import { toDate } from '../../../../../prisma/dates';

export type SessionRow = {
  id: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  user: UserRow | null;
};

export class SessionMapper {
  static toDomain(raw: SessionRow): Session {
    const domainEntity = new Session();
    domainEntity.id = raw.id;
    if (raw.user) {
      domainEntity.user = UserMapper.toDomain(raw.user);
    }
    domainEntity.hash = raw.hash;
    domainEntity.createdAt = toDate(raw.createdAt);
    domainEntity.updatedAt = toDate(raw.updatedAt);
    domainEntity.deletedAt = toDate(raw.deletedAt) as Date;
    return domainEntity;
  }
}
