import { Exclude, Expose } from 'class-transformer';
import { FileType } from '../../files/domain/file';
import { Role } from '../../roles/domain/role';
import { ApiProperty } from '@nestjs/swagger';

const idType = Number;

export class User {
  @ApiProperty({
    type: idType,
  })
  id: number | string;

  @ApiProperty({
    type: String,
    example: 'john.doe@example.com',
  })
  @Expose({ groups: ['me', 'admin'] })
  email: string | null;

  @Exclude({ toPlainOnly: true })
  password?: string;

  @ApiProperty({
    type: String,
    example: 'email',
  })
  @Expose({ groups: ['me', 'admin'] })
  provider: string;

  @ApiProperty({
    type: String,
    example: '1234567890',
  })
  @Expose({ groups: ['me', 'admin'] })
  socialId?: string | null;

  @ApiProperty({
    type: String,
    example: 'John',
  })
  firstName: string | null;

  @ApiProperty({
    type: String,
    example: 'Doe',
  })
  lastName: string | null;

  @ApiProperty({
    type: () => FileType,
  })
  photo?: FileType | null;

  @ApiProperty({
    type: () => Role,
  })
  role?: Role | null;

  @ApiProperty({ type: Boolean, example: true })
  active: boolean;

  @Exclude({ toPlainOnly: true })
  mustChangePassword: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose({ groups: ['me', 'admin'] })
  telegramId?: string | null;

  @ApiProperty({ type: String, required: false })
  @Expose({ groups: ['me', 'admin'] })
  telegramUsername?: string | null;

  @Exclude({ toPlainOnly: true })
  telegramLinkToken?: string | null;

  @Exclude({ toPlainOnly: true })
  telegramLinkExpiresAt?: Date | null;

  @ApiProperty({ type: String, required: false })
  department?: string | null;

  @ApiProperty({ type: String, required: false })
  @Expose({ groups: ['me', 'admin'] })
  paymentLink?: string | null;

  @ApiProperty({ type: String, required: false })
  @Expose({ groups: ['me', 'admin'] })
  paymentQrObjectKey?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  deletedAt: Date;
}
