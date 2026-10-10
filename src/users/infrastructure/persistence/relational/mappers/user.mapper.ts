import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { User } from '../../../../domain/user';
import { toDate } from '../../../../../prisma/dates';
import { timestamptz } from '../../../../../prisma/numeric';

/** A user row as the repository loads it: role and photo always included. */
export type UserRow = {
  id: number;
  email: string | null;
  password: string | null;
  provider: string;
  socialId: string | null;
  firstName: string | null;
  lastName: string | null;
  photo: { id: string; path: string } | null;
  role: { id: number; name: string } | null;
  active: boolean;
  mustChangePassword: boolean;
  telegramId: bigint | null;
  telegramUsername: string | null;
  telegramLinkToken: string | null;
  telegramLinkExpiresAt: string | null;
  department: string | null;
  paymentLink: string | null;
  paymentQrObjectKey: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export class UserMapper {
  static toDomain(raw: UserRow): User {
    const domainEntity = new User();
    domainEntity.id = raw.id;
    domainEntity.email = raw.email;
    domainEntity.password = raw.password ?? undefined;
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
    // bigint column: Prisma returns BigInt; the app treats Telegram ids as strings.
    domainEntity.telegramId =
      raw.telegramId === null ? null : String(raw.telegramId);
    domainEntity.telegramUsername = raw.telegramUsername;
    domainEntity.telegramLinkToken = raw.telegramLinkToken;
    domainEntity.telegramLinkExpiresAt = toDate(raw.telegramLinkExpiresAt);
    domainEntity.department = raw.department;
    domainEntity.paymentLink = raw.paymentLink;
    domainEntity.paymentQrObjectKey = raw.paymentQrObjectKey;
    domainEntity.createdAt = toDate(raw.createdAt);
    domainEntity.updatedAt = toDate(raw.updatedAt);
    domainEntity.deletedAt = toDate(raw.deletedAt) as Date;
    return domainEntity;
  }

  /**
   * The columns to write for these domain fields. A field that is `undefined` is left
   * out, so it keeps its stored value; `null` clears it.
   */
  static toWrite(user: Partial<User>) {
    const out = {
      email: user.email,
      password: user.password,
      provider: user.provider,
      socialId: user.socialId,
      firstName: user.firstName,
      lastName: user.lastName,
      photoId: user.photo === undefined ? undefined : (user.photo?.id ?? null),
      roleId:
        user.role === undefined
          ? undefined
          : user.role
            ? Number(user.role.id)
            : null,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      telegramId:
        user.telegramId === undefined
          ? undefined
          : user.telegramId === null
            ? null
            : BigInt(user.telegramId),
      telegramUsername: user.telegramUsername,
      telegramLinkToken: user.telegramLinkToken,
      telegramLinkExpiresAt:
        user.telegramLinkExpiresAt === undefined
          ? undefined
          : user.telegramLinkExpiresAt === null
            ? null
            : timestamptz(user.telegramLinkExpiresAt),
      department: user.department,
      paymentLink: user.paymentLink,
      paymentQrObjectKey: user.paymentQrObjectKey,
    };

    return Object.fromEntries(
      Object.entries(out).filter(([, value]) => value !== undefined),
    ) as Partial<typeof out>;
  }
}
