import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { lowerCaseTransformer } from '../../utils/transformers/lower-case.transformer';

export class MiniAppLinkDto {
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string;

  @IsNotEmpty()
  password: string;

  // Carried in the body when the webview cannot set headers; decorated so the
  // whitelisting validator keeps it.
  @IsOptional()
  @IsString()
  initData?: string;
}
