import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CurrencyEnum, PaymentMethodEnum } from '../../common/enums';

export class RecordPaymentDto {
  // Optional: a standalone direct expense has no purchase order.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  poId?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0.0001, { message: 'Amount must be greater than zero' })
  amountOriginal: number;

  @IsEnum(CurrencyEnum, { message: 'Choose a currency' })
  currency: CurrencyEnum;

  // C1: required when there is no PO to inherit an account from.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expenseAccountId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(PaymentMethodEnum)
  method?: PaymentMethodEnum;

  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() trxId?: string;
  @IsOptional() @IsString() sender?: string;
  @IsOptional() @IsString() transferTo?: string;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsString() paidAt?: string;
  @IsOptional() @IsString() receiptObjectKey?: string;
}
