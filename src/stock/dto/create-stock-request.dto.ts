import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { StockPriorityEnum } from '../../common/enums';

export class CreateStockRequestDto {
  @Type(() => Number)
  @IsInt({ message: 'Choose an item' })
  inventoryItemId: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  qty: number;

  @IsEnum(StockPriorityEnum)
  priority: StockPriorityEnum = StockPriorityEnum.medium;

  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() note?: string;
}
