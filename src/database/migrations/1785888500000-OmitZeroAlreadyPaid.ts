import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The over-payment message always said "$0.00 USD is already paid" even on the very first
 * payment against a PO, which reads oddly since nothing has actually been paid yet. Drops
 * that clause when v_paid = 0; the "already paid" phrasing only applies once there's a
 * prior payment to refer to. Only the RAISE EXCEPTION branch changes.
 */
export class OmitZeroAlreadyPaid1785888500000 implements MigrationInterface {
  name = 'OmitZeroAlreadyPaid1785888500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION on_payment_insert() RETURNS trigger AS $$
      DECLARE
        v_po purchase_orders%ROWTYPE;
        v_paid numeric(18,4);
        v_tolerance numeric;
        v_expense_account_id integer;
        v_cash_account_id integer;
        v_entry_id integer;
        v_memo text;
        v_message text;
        v_department_id integer;
        v_project_id integer;
      BEGIN
        IF NEW.po_id IS NOT NULL THEN
          SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.po_id FOR UPDATE;

          -- 1. C3 over-payment guard, compared in USD
          SELECT COALESCE(sum(amount_usd), 0) INTO v_paid
            FROM payments WHERE po_id = NEW.po_id AND id <> NEW.id;

          v_tolerance := app_setting_numeric('payment_tolerance_pct', 0);

          IF v_paid + NEW.amount_usd > v_po.total_usd * (1 + v_tolerance) THEN
            IF v_paid = 0 THEN
              v_message := format(
                'Cannot record this payment: %s has a total of $%s USD, and this $%s USD payment exceeds it.',
                v_po.po_number, round(v_po.total_usd, 2), round(NEW.amount_usd, 2));
            ELSE
              v_message := format(
                'Cannot record this payment: %s has a total of $%s USD. $%s USD is already paid, and this $%s USD payment would bring the total paid to $%s USD.',
                v_po.po_number, round(v_po.total_usd, 2), round(v_paid, 2),
                round(NEW.amount_usd, 2), round(v_paid + NEW.amount_usd, 2));
            END IF;
            RAISE EXCEPTION '%', v_message;
          END IF;

          v_department_id := v_po.department_id;
          v_project_id := v_po.project_id;
          v_memo := 'Payment for ' || v_po.po_number;
        ELSE
          v_memo := 'Payment (direct expense)';
        END IF;

        -- 2. C1 expense account resolution
        SELECT id INTO v_expense_account_id FROM accounts WHERE code = '6900';
        v_expense_account_id := COALESCE(
          v_po.expense_account_id, NEW.expense_account_id, v_expense_account_id);

        SELECT id INTO v_cash_account_id FROM accounts WHERE code = '1000';
        IF v_cash_account_id IS NULL OR v_expense_account_id IS NULL THEN
          RAISE EXCEPTION 'chart of accounts is not seeded: 1000 and 6900 are required';
        END IF;

        -- 3. the journal entry
        INSERT INTO journal_entries
          (entry_date, memo, currency, exchange_rate, source, source_ref, created_by)
        VALUES
          (NEW.paid_at::date, v_memo, NEW.currency, NEW.exchange_rate,
           'po_payment', NEW.id, NEW.recorded_by)
        RETURNING id INTO v_entry_id;

        -- 4. DR expense / CR cash — cash-basis, nothing touches 2000 A/P
        INSERT INTO journal_lines
          (entry_id, account_id, debit_usd, credit_usd,
           dimension_department_id, dimension_project_id)
        VALUES
          (v_entry_id, v_expense_account_id, NEW.amount_usd, 0,
           v_department_id, v_project_id),
          (v_entry_id, v_cash_account_id, 0, NEW.amount_usd,
           v_department_id, v_project_id);

        -- 5. link the entry back to the payment
        UPDATE payments SET journal_entry_id = v_entry_id WHERE id = NEW.id;

        -- 6. roll up the PO payment status
        IF NEW.po_id IS NOT NULL THEN
          SELECT COALESCE(sum(amount_usd), 0) INTO v_paid
            FROM payments WHERE po_id = NEW.po_id;

          UPDATE purchase_orders
             SET payment_status = CASE
                   WHEN v_paid >= v_po.total_usd THEN 'paid'::payment_status
                   WHEN v_paid <= 0 THEN 'unpaid'::payment_status
                   ELSE 'partial'::payment_status END
           WHERE id = NEW.po_id;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION on_payment_insert() RETURNS trigger AS $$
      DECLARE
        v_po purchase_orders%ROWTYPE;
        v_paid numeric(18,4);
        v_tolerance numeric;
        v_expense_account_id integer;
        v_cash_account_id integer;
        v_entry_id integer;
        v_memo text;
        v_department_id integer;
        v_project_id integer;
      BEGIN
        IF NEW.po_id IS NOT NULL THEN
          SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.po_id FOR UPDATE;

          -- 1. C3 over-payment guard, compared in USD
          SELECT COALESCE(sum(amount_usd), 0) INTO v_paid
            FROM payments WHERE po_id = NEW.po_id AND id <> NEW.id;

          v_tolerance := app_setting_numeric('payment_tolerance_pct', 0);

          IF v_paid + NEW.amount_usd > v_po.total_usd * (1 + v_tolerance) THEN
            RAISE EXCEPTION
              'Cannot record this payment: % has a total of $% USD. $% USD is already paid, and this $% USD payment would bring the total paid to $% USD.',
              v_po.po_number, round(v_po.total_usd, 2), round(v_paid, 2),
              round(NEW.amount_usd, 2), round(v_paid + NEW.amount_usd, 2);
          END IF;

          v_department_id := v_po.department_id;
          v_project_id := v_po.project_id;
          v_memo := 'Payment for ' || v_po.po_number;
        ELSE
          v_memo := 'Payment (direct expense)';
        END IF;

        -- 2. C1 expense account resolution
        SELECT id INTO v_expense_account_id FROM accounts WHERE code = '6900';
        v_expense_account_id := COALESCE(
          v_po.expense_account_id, NEW.expense_account_id, v_expense_account_id);

        SELECT id INTO v_cash_account_id FROM accounts WHERE code = '1000';
        IF v_cash_account_id IS NULL OR v_expense_account_id IS NULL THEN
          RAISE EXCEPTION 'chart of accounts is not seeded: 1000 and 6900 are required';
        END IF;

        -- 3. the journal entry
        INSERT INTO journal_entries
          (entry_date, memo, currency, exchange_rate, source, source_ref, created_by)
        VALUES
          (NEW.paid_at::date, v_memo, NEW.currency, NEW.exchange_rate,
           'po_payment', NEW.id, NEW.recorded_by)
        RETURNING id INTO v_entry_id;

        -- 4. DR expense / CR cash — cash-basis, nothing touches 2000 A/P
        INSERT INTO journal_lines
          (entry_id, account_id, debit_usd, credit_usd,
           dimension_department_id, dimension_project_id)
        VALUES
          (v_entry_id, v_expense_account_id, NEW.amount_usd, 0,
           v_department_id, v_project_id),
          (v_entry_id, v_cash_account_id, 0, NEW.amount_usd,
           v_department_id, v_project_id);

        -- 5. link the entry back to the payment
        UPDATE payments SET journal_entry_id = v_entry_id WHERE id = NEW.id;

        -- 6. roll up the PO payment status
        IF NEW.po_id IS NOT NULL THEN
          SELECT COALESCE(sum(amount_usd), 0) INTO v_paid
            FROM payments WHERE po_id = NEW.po_id;

          UPDATE purchase_orders
             SET payment_status = CASE
                   WHEN v_paid >= v_po.total_usd THEN 'paid'::payment_status
                   WHEN v_paid <= 0 THEN 'unpaid'::payment_status
                   ELSE 'partial'::payment_status END
           WHERE id = NEW.po_id;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }
}
