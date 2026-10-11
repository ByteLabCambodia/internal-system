import { MigrationInterface, QueryRunner } from './query-runner';

/**
 * Moves the workflow triggers into the services that own them:
 *   T3 on_claim_confirmed         -> ClaimsService.confirm
 *   T4 on_stock_request_fulfilled -> StockRequestsService.fulfil
 *   T5 on_payment_insert          -> PaymentsService.record (+ JournalService.postPayment)
 * app_setting_numeric() only existed for T3/T5; tolerances are read via SettingsService.
 *
 * Kept on purpose: T2 (journal entries must balance) as the ledger's backstop.
 *
 * Deploy note: old app code relies on these triggers. Ship this with the matching service
 * code and do not record payments, confirm claims or fulfil stock requests while the
 * release rolls out.
 *
 * `down` restores the latest definitions (on_payment_insert from OmitZeroAlreadyPaid).
 */
export class MoveWorkflowTriggersToServices1785888700000 implements MigrationInterface {
  name = 'MoveWorkflowTriggersToServices1785888700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "payments_on_insert" ON "payments"`);
    await queryRunner.query(`DROP FUNCTION on_payment_insert()`);
    await queryRunner.query(
      `DROP TRIGGER "stock_requests_on_fulfilled" ON "stock_requests"`,
    );
    await queryRunner.query(`DROP FUNCTION on_stock_request_fulfilled()`);
    await queryRunner.query(
      `DROP TRIGGER "inventory_claims_on_confirmed" ON "inventory_claims"`,
    );
    await queryRunner.query(`DROP FUNCTION on_claim_confirmed()`);
    await queryRunner.query(`DROP FUNCTION app_setting_numeric(text, numeric)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION app_setting_numeric(p_key text, p_default numeric)
      RETURNS numeric AS $$
      DECLARE v_value text;
      BEGIN
        SELECT value INTO v_value FROM app_settings WHERE key = p_key;
        IF v_value IS NULL OR btrim(v_value) = '' THEN
          RETURN p_default;
        END IF;
        RETURN v_value::numeric;
      EXCEPTION WHEN others THEN
        RETURN p_default;
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // --- T3: claim confirmed ------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION on_claim_confirmed() RETURNS trigger AS $$
      DECLARE
        v_new_balance numeric(18,4);
        v_qty_ordered numeric(18,4);
        v_qty_claimed numeric(18,4);
        v_tolerance numeric;
        v_po_id integer;
        v_po_status po_status;
        v_incomplete integer;
      BEGIN
        IF NEW.status <> 'confirmed' OR OLD.status = 'confirmed' THEN
          RETURN NEW;
        END IF;

        -- 1. C3 over-receipt guard
        IF NEW.po_item_id IS NOT NULL THEN
          SELECT qty_ordered, qty_claimed INTO v_qty_ordered, v_qty_claimed
            FROM purchase_order_items WHERE id = NEW.po_item_id FOR UPDATE;

          v_tolerance := app_setting_numeric('receipt_tolerance_pct', 0);

          IF v_qty_claimed + NEW.qty_claimed > v_qty_ordered * (1 + v_tolerance) THEN
            RAISE EXCEPTION
              'over-receipt on purchase order line %: % already claimed + % exceeds % ordered',
              NEW.po_item_id, v_qty_claimed, NEW.qty_claimed, v_qty_ordered;
          END IF;
        END IF;

        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());

        -- 2. stock increases
        UPDATE inventory_items
           SET stock_qty = stock_qty + NEW.qty_claimed
         WHERE id = NEW.inventory_item_id
        RETURNING stock_qty INTO v_new_balance;

        -- 3. append to the movement ledger
        INSERT INTO stock_movements
          (inventory_item_id, delta, reason, ref_table, ref_id, balance_after, created_by)
        VALUES
          (NEW.inventory_item_id, NEW.qty_claimed, 'claim', 'inventory_claims', NEW.id,
           v_new_balance, NEW.confirmed_by);

        -- 4. and 5. roll the PO line and the PO forward
        IF NEW.po_item_id IS NOT NULL THEN
          UPDATE purchase_order_items
             SET qty_claimed = qty_claimed + NEW.qty_claimed
           WHERE id = NEW.po_item_id
          RETURNING po_id INTO v_po_id;

          SELECT status INTO v_po_status FROM purchase_orders WHERE id = v_po_id;

          IF v_po_status <> 'cancelled' THEN
            SELECT count(*) INTO v_incomplete
              FROM purchase_order_items
             WHERE po_id = v_po_id AND qty_claimed < qty_ordered;

            UPDATE purchase_orders
               SET status = CASE WHEN v_incomplete = 0 THEN 'complete'::po_status
                                 ELSE 'partial'::po_status END
             WHERE id = v_po_id;
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "inventory_claims_on_confirmed"
      BEFORE UPDATE OF status ON "inventory_claims"
      FOR EACH ROW EXECUTE FUNCTION on_claim_confirmed();
    `);

    // --- T4: stock request fulfilled ------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION on_stock_request_fulfilled() RETURNS trigger AS $$
      DECLARE
        v_item inventory_items%ROWTYPE;
        v_new_balance numeric(18,4);
        v_pr_id integer;
      BEGIN
        IF NEW.status <> 'fulfilled' OR OLD.status = 'fulfilled' THEN
          RETURN NEW;
        END IF;

        SELECT * INTO v_item FROM inventory_items
         WHERE id = NEW.inventory_item_id FOR UPDATE;

        IF v_item.stock_qty < NEW.qty THEN
          RAISE EXCEPTION
            'insufficient stock for %: % on hand, % requested',
            v_item.sku, v_item.stock_qty, NEW.qty;
        END IF;

        NEW.fulfilled_at := COALESCE(NEW.fulfilled_at, now());

        UPDATE inventory_items
           SET stock_qty = stock_qty - NEW.qty
         WHERE id = NEW.inventory_item_id
        RETURNING stock_qty INTO v_new_balance;

        INSERT INTO stock_movements
          (inventory_item_id, delta, reason, ref_table, ref_id, balance_after, created_by)
        VALUES
          (NEW.inventory_item_id, -NEW.qty, 'stock_request', 'stock_requests', NEW.id,
           v_new_balance, NEW.fulfilled_by);

        -- auto-reorder: raise a draft PR and tell the managers
        IF v_new_balance <= v_item.reorder_point AND v_item.reorder_qty > 0 THEN
          INSERT INTO purchase_requests
            (requester_id, status, currency, exchange_rate, total_original,
             auto_generated, note)
          VALUES
            (NEW.requester_id, 'draft', 'USD', 1, 0, true,
             'Auto-reorder: ' || v_item.sku || ' at/below reorder point')
          RETURNING id INTO v_pr_id;

          INSERT INTO purchase_request_items
            (pr_id, name, qty, unit_price_original, inventory_item_id, category)
          VALUES
            (v_pr_id, v_item.name, v_item.reorder_qty, 0, v_item.id, v_item.category);

          INSERT INTO notifications (user_id, event, payload)
          SELECT u.id,
                 'stock_below_reorder',
                 jsonb_build_object(
                   'inventory_item_id', v_item.id,
                   'sku', v_item.sku,
                   'name', v_item.name,
                   'balance_after', v_new_balance,
                   'reorder_point', v_item.reorder_point,
                   'purchase_request_id', v_pr_id)
            FROM "user" u
           WHERE u.active = true
             AND u."deletedAt" IS NULL
             AND u."roleId" IN (1, 2);   -- admin, manager
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "stock_requests_on_fulfilled"
      BEFORE UPDATE OF status ON "stock_requests"
      FOR EACH ROW EXECUTE FUNCTION on_stock_request_fulfilled();
    `);

    // --- T5: payment recorded (cash-basis, C5a) -------------------------------------------
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
    await queryRunner.query(`
      CREATE TRIGGER "payments_on_insert"
      AFTER INSERT ON "payments"
      FOR EACH ROW EXECUTE FUNCTION on_payment_insert();
    `);
  }
}
