import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CurrencyEnum,
  DiscountTypeEnum,
  PaymentMethodEnum,
  SalesDocLanguageEnum,
  SalesDocTypeEnum,
} from '../../common/enums';

export class SalesDocumentItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Every line needs a description' })
  description: string;

  @IsOptional() @IsString() detail?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  qty: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Unit price must be a number' })
  @Min(0, { message: 'Unit price cannot be negative' })
  unitPrice: number;
}

/** Quotations and invoices share one form; receipts are only ever made from an invoice. */
export class SalesDocumentDto {
  @IsIn([SalesDocTypeEnum.quotation, SalesDocTypeEnum.invoice])
  type: SalesDocTypeEnum.quotation | SalesDocTypeEnum.invoice;

  @Type(() => Number)
  @IsInt({ message: 'Choose a customer' })
  customerId: number;

  @IsDateString({}, { message: 'Enter the document date' })
  issueDate: string;

  @IsOptional() @IsDateString() dueDate?: string;

  @IsEnum(CurrencyEnum)
  currency: CurrencyEnum;

  @Type(() => Number)
  @IsNumber({}, { message: 'VAT rate must be a number' })
  @Min(0, { message: 'VAT rate cannot be negative' })
  @Max(100, { message: 'VAT rate is a percentage, at most 100' })
  vatRate: number;

  @IsEnum(SalesDocLanguageEnum, { message: 'Choose the document language' })
  language: SalesDocLanguageEnum;

  @IsOptional()
  @IsEnum(DiscountTypeEnum)
  discountType?: DiscountTypeEnum;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Discount must be a number' })
  @Min(0, { message: 'Discount cannot be negative' })
  discountValue?: number;

  @IsOptional()
  @IsEnum(DiscountTypeEnum)
  depositType?: DiscountTypeEnum;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Deposit must be a number' })
  @Min(0, { message: 'Deposit cannot be negative' })
  depositValue?: number;

  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => SalesDocumentItemDto)
  items: SalesDocumentItemDto[];
}

export class RecordReceiptDto {
  @IsDateString({}, { message: 'Enter the payment date' })
  paidOn: string;

  @IsEnum(PaymentMethodEnum, { message: 'Choose how the customer paid' })
  paymentMethod: PaymentMethodEnum;

  @IsOptional() @IsString() paymentReference?: string;

  // Omitted: pay everything still due.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0.01, { message: 'Amount must be greater than zero' })
  amount?: number;
}
