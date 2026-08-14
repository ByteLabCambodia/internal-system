import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { lowerCaseTransformer } from '../../utils/transformers/lower-case.transformer';

class BaseUserFormDto {
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  lastName: string;

  @Transform(lowerCaseTransformer)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @Type(() => Number)
  @IsInt({ message: 'Choose a role' })
  roleId: number;

  @IsOptional()
  @IsString()
  department?: string;
}

export class CreateUserFormDto extends BaseUserFormDto {
  /** Which of the two creation modes the admin picked. */
  @IsIn(['invite', 'password'], { message: 'Choose how to set the password' })
  mode: 'invite' | 'password';

  // Validated against the mode in the controller: required when mode is `password`,
  // and must be absent otherwise.
  @IsOptional()
  @IsString()
  password?: string;
}

export class UpdateUserFormDto extends BaseUserFormDto {
  @IsIn(['true', 'false'])
  active: string;

  @IsOptional()
  @IsString()
  telegramId?: string;

  /** Blank means unchanged. */
  @IsOptional()
  @IsString()
  password?: string;
}
