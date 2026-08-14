import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { CurrencyEnum, RateSourceEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';

// rate_to_usd is units of `currency` per 1 USD.
@Entity({ name: 'exchange_rates' })
@Unique('exchange_rates_date_currency_key', ['rateDate', 'currency'])
export class ExchangeRateEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'rate_date', type: 'date' })
  rateDate: string;

  @Column({
    name: 'currency',
    type: 'enum',
    enum: CurrencyEnum,
    enumName: 'currency',
  })
  currency: CurrencyEnum;

  @Column({
    name: 'rate_to_usd',
    type: 'numeric',
    precision: 18,
    scale: 6,
    transformer: numericTransformer,
  })
  rateToUsd: string;

  @Column({
    name: 'source',
    type: 'enum',
    enum: RateSourceEnum,
    enumName: 'rate_source',
    default: RateSourceEnum.manual,
  })
  source: RateSourceEnum;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
