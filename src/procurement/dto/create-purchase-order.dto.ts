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
import { PoTypeEnum } from '../../common/enums';

export class PurchaseOrderItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Every line needs a description' })
  name: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity ordered must be greater than zero' })
  qtyOrdered: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Unit price must be a number' })
  @Min(0, { message: 'Unit price cannot be negative' })
  unitPrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  inventoryItemId?: number;
}

export class CreatePurchaseOrderDto {
  @Type(() => Number)
  @IsInt({ message: 'Choose the approved purchase request this order fulfils' })
  prId: number;

  @IsEnum(PoTypeEnum)
  type: PoTypeEnum;

  // Either an existing supplier or a name to create on the fly (C4).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @IsString()
  supplierName?: string;

  // C1: resolved from the line categories, overridable by finance.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expenseAccountId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
