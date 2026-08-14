import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrencyEnum } from '../../common/enums';

/**
 * HTML forms submit strings, so every numeric field is coerced with @Type(() => Number)
 * rather than trusting the transport. Line items arrive as items[0][name] etc.
 */
export class PurchaseRequestItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Every line needs a description' })
  name: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  qty: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Unit price must be a number' })
  @Min(0, { message: 'Unit price cannot be negative' })
  unitPrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  inventoryItemId?: number;

  @IsOptional()
  @IsString()
  category?: string;
}

export class CreatePurchaseRequestDto {
  @IsEnum(CurrencyEnum, { message: 'Choose a currency' })
  currency: CurrencyEnum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items: PurchaseRequestItemDto[];
}
