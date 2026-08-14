import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class NewPasswordFormDto {
  @MinLength(8, { message: 'Use at least 8 characters' })
  password: string;

  @IsNotEmpty({ message: 'Confirm your new password' })
  passwordConfirmation: string;

  // Decorated so the whitelisting validator keeps it — an undecorated property is stripped.
  @IsOptional()
  @IsString()
  token?: string;
}
