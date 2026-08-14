import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CurrencyEnum } from '../enums';

export type MoneyInput = string | number | Decimal | null | undefined;

/**
 * All money arithmetic goes through here. Values are decimal strings end to end — never a
 * JS float. `exchangeRate` is units of the currency per 1 USD, so USD is always 1.
 * Stored at 4dp, displayed at 2dp.
 */
@Injectable()
export class MoneyService {
  private toDecimal(value: MoneyInput): Decimal {
    if (value === null || value === undefined || value === '') {
      return new Decimal(0);
    }
    return new Decimal(value);
  }

  /** Round to the stored scale (4dp), half-up, matching the DB triggers. */
  round(value: MoneyInput, dp = 4): string {
    return this.toDecimal(value).toFixed(dp, Decimal.ROUND_HALF_UP);
  }

  add(a: MoneyInput, b: MoneyInput): string {
    return this.round(this.toDecimal(a).plus(this.toDecimal(b)));
  }

  multiply(a: MoneyInput, b: MoneyInput): string {
    return this.round(this.toDecimal(a).times(this.toDecimal(b)));
  }

  /** Line total: qty × unit price, at the stored scale. */
  lineTotal(qty: MoneyInput, unitPrice: MoneyInput): string {
    return this.multiply(qty, unitPrice);
  }

  sum(values: MoneyInput[]): string {
    return this.round(
      values.reduce<Decimal>(
        (total, value) => total.plus(this.toDecimal(value)),
        new Decimal(0),
      ),
    );
  }

  /**
   * amount_usd = amount_original / exchange_rate. The DB triggers derive this for stored
   * records; this is for previews and for figures that never hit a trigger.
   */
  toUsd(amountOriginal: MoneyInput, exchangeRate: MoneyInput): string {
    const rate = this.toDecimal(exchangeRate);

    if (rate.lessThanOrEqualTo(0)) {
      throw new Error('exchange_rate must be greater than 0');
    }

    return this.round(this.toDecimal(amountOriginal).dividedBy(rate));
  }

  isPositive(value: MoneyInput): boolean {
    return this.toDecimal(value).greaterThan(0);
  }

  compare(a: MoneyInput, b: MoneyInput): number {
    return this.toDecimal(a).comparedTo(this.toDecimal(b));
  }

  /** Display form: 2dp with thousands separators, and always the currency. */
  format(value: MoneyInput, currency: CurrencyEnum | string = 'USD'): string {
    const amount = this.toDecimal(value).toFixed(2, Decimal.ROUND_HALF_UP);
    const [whole, fraction] = amount.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${grouped}.${fraction} ${currency}`;
  }

  formatUsd(value: MoneyInput): string {
    const amount = this.toDecimal(value).toFixed(2, Decimal.ROUND_HALF_UP);
    const [whole, fraction] = amount.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `$${grouped}.${fraction}`;
  }
}
