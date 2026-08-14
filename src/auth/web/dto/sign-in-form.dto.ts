import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { lowerCaseTransformer } from '../../../utils/transformers/lower-case.transformer';

export class SignInFormDto {
  @Transform(lowerCaseTransformer)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Enter your password' })
  password: string;

  // Decorated so the whitelisting validator keeps it — an undecorated property is stripped.
  @IsOptional()
  @IsString()
  next?: string;
}
