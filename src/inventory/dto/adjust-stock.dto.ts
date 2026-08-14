import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustStockDto {
  // Signed: +5 receives, -5 writes off. Zero is rejected by the service.
  @Type(() => Number)
  @IsNumber({}, { message: 'Enter an amount to add or remove' })
  delta: number;

  @IsOptional()
  @IsString()
  note?: string;
}
