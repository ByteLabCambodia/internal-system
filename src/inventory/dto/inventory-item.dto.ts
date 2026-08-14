import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class InventoryItemDto {
  @IsString()
  @IsNotEmpty({ message: 'A SKU is required' })
  sku: string;

  @IsString()
  @IsNotEmpty({ message: 'A name is required' })
  name: string;

  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Reorder point must be a number' })
  @Min(0, { message: 'Reorder point cannot be negative' })
  reorderPoint?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Reorder quantity must be a number' })
  @Min(0, { message: 'Reorder quantity cannot be negative' })
  reorderQty?: number;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
