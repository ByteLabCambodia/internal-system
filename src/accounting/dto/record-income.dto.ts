import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CurrencyEnum } from '../../common/enums';

export class RecordIncomeDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0.0001, { message: 'Amount must be greater than zero' })
  amountOriginal: number;

  @IsEnum(CurrencyEnum, { message: 'Choose a currency' })
  currency: CurrencyEnum;

  @Type(() => Number)
  @IsInt({ message: 'Choose the income account to credit' })
  incomeAccountId: number;

  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsString() entryDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;
}
