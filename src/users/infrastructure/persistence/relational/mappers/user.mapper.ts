import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { RoleEntity } from '../../../../../roles/infrastructure/persistence/relational/entities/role.entity';
import { User } from '../../../../domain/user';
import { UserEntity } from '../entities/user.entity';

export class UserMapper {
  static toDomain(raw: UserEntity): User {
    const domainEntity = new User();
    domainEntity.id = raw.id;
    domainEntity.email = raw.email;
    domainEntity.password = raw.password;
    domainEntity.provider = raw.provider;
    domainEntity.socialId = raw.socialId;
    domainEntity.firstName = raw.firstName;
    domainEntity.lastName = raw.lastName;
    if (raw.photo) {
      domainEntity.photo = FileMapper.toDomain(raw.photo);
    }
    domainEntity.role = raw.role;
    domainEntity.active = raw.active;
    domainEntity.mustChangePassword = raw.mustChangePassword;
    domainEntity.telegramId = raw.telegramId;
    domainEntity.telegramUsername = raw.telegramUsername;
    domainEntity.telegramLinkToken = raw.telegramLinkToken;
    domainEntity.telegramLinkExpiresAt = raw.telegramLinkExpiresAt;
    domainEntity.department = raw.department;
    domainEntity.paymentLink = raw.paymentLink;
    domainEntity.paymentQrObjectKey = raw.paymentQrObjectKey;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;
    domainEntity.deletedAt = raw.deletedAt;
    return domainEntity;
  }

  static toPersistence(domainEntity: User): UserEntity {
    let role: RoleEntity | undefined = undefined;

    if (domainEntity.role) {
      role = new RoleEntity();
      role.id = Number(domainEntity.role.id);
    }

    let photo: FileEntity | undefined | null = undefined;

    if (domainEntity.photo) {
      photo = new FileEntity();
      photo.id = domainEntity.photo.id;
      photo.path = domainEntity.photo.path;
    } else if (domainEntity.photo === null) {
      photo = null;
    }

    const persistenceEntity = new UserEntity();
    if (domainEntity.id && typeof domainEntity.id === 'number') {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.email = domainEntity.email;
    persistenceEntity.password = domainEntity.password;
    persistenceEntity.provider = domainEntity.provider;
    persistenceEntity.socialId = domainEntity.socialId;
    persistenceEntity.firstName = domainEntity.firstName;
    persistenceEntity.lastName = domainEntity.lastName;
    persistenceEntity.photo = photo;
    persistenceEntity.role = role;
    persistenceEntity.active = domainEntity.active;
    persistenceEntity.mustChangePassword = domainEntity.mustChangePassword;
    persistenceEntity.telegramId = domainEntity.telegramId ?? null;
    persistenceEntity.telegramUsername = domainEntity.telegramUsername ?? null;
    persistenceEntity.telegramLinkToken =
      domainEntity.telegramLinkToken ?? null;
    persistenceEntity.telegramLinkExpiresAt =
      domainEntity.telegramLinkExpiresAt ?? null;
    persistenceEntity.department = domainEntity.department ?? null;
    persistenceEntity.paymentLink = domainEntity.paymentLink ?? null;
    persistenceEntity.paymentQrObjectKey =
      domainEntity.paymentQrObjectKey ?? null;
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;
    persistenceEntity.deletedAt = domainEntity.deletedAt;
    return persistenceEntity;
  }
}
