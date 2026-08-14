import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'A category needs a name' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // C1: the GL account spend in this category debits.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expenseAccountId?: number;
}
