import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateClaimDto {
  @Type(() => Number)
  @IsInt({ message: 'Choose the order line these goods arrived against' })
  poItemId: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  qtyClaimed: number;

  // Only needed when the order line is not already linked to a catalog item.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  inventoryItemId?: number;

  @IsOptional()
  @IsString()
  receiptObjectKey?: string;
}
