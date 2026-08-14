import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { lowerCaseTransformer } from '../../../utils/transformers/lower-case.transformer';

export class EmailFormDto {
  @Transform(lowerCaseTransformer)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;
}
