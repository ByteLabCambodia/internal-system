import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, Min } from 'class-validator';
import { CurrencyEnum } from '../../common/enums';

export class ExchangeRateDto {
  @IsDateString({}, { message: 'Use a YYYY-MM-DD date' })
  rateDate: string;

  @IsEnum(CurrencyEnum, { message: 'Choose a currency' })
  currency: CurrencyEnum;

  // Units of the currency per 1 USD.
  @Type(() => Number)
  @IsNumber({}, { message: 'Rate must be a number' })
  @Min(0.000001, { message: 'Rate must be greater than zero' })
  rateToUsd: number;
}
