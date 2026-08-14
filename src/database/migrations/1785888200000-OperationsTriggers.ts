import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invariants T1–T6 from Part 2.7 of NESTJS_MIGRATION_BRIEF.md, plus the usual
 * set_updated_at() housekeeping trigger.
 *
 * These are the authority: services must NOT reimplement this logic. Write, then re-read
 * the row to pick up what the trigger derived.
 *
 * C5 is settled as **cash-basis** (see AGENTS.md): a payment posts DR expense / CR 1000
 * Cash. Nothing posts to 2000 Accounts Payable.
 */
export class OperationsTriggers1785888200000 implements MigrationInterface {
  name = 'OperationsTriggers1785888200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- housekeeping -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const updatedAtTables = [
      'app_settings',
      'departments',
      'projects',
      'suppliers',
      'accounts',
      'journal_entries',
      'exchange_rates',
      'budgets',
      'categories',
      'inventory_items',
      'inventory_claims',
      'stock_requests',
      'purchase_requests',
      'purchase_orders',
      'payments',
    ];
    for (const table of updatedAtTables) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_set_updated_at"
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      `);
    }

    // Tolerances are data, not env — a trigger cannot read the app's config.
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

    // --- T1: derive USD amounts --------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION derive_amount_usd() RETURNS trigger AS $$
      BEGIN
        IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
          RAISE EXCEPTION 'exchange_rate must be greater than 0 (got %)', NEW.exchange_rate;
        END IF;
        NEW.amount_usd := round(NEW.amount_original / NEW.exchange_rate, 4);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION derive_total_usd() RETURNS trigger AS $$
      BEGIN
        IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
          RAISE EXCEPTION 'exchange_rate must be greater than 0 (got %)', NEW.exchange_rate;
        END IF;
        NEW.total_usd := round(NEW.total_original / NEW.exchange_rate, 4);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "payments_derive_amount_usd"
      BEFORE INSERT OR UPDATE OF amount_original, exchange_rate ON "payments"
      FOR EACH ROW EXECUTE FUNCTION derive_amount_usd();
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_requests_derive_total_usd"
      BEFORE INSERT OR UPDATE OF total_original, exchange_rate ON "purchase_requests"
      FOR EACH ROW EXECUTE FUNCTION derive_total_usd();
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_orders_derive_total_usd"
      BEFORE INSERT OR UPDATE OF total_original, exchange_rate ON "purchase_orders"
      FOR EACH ROW EXECUTE FUNCTION derive_total_usd();
    `);

    // --- T2: journal entries must balance ----------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
      DECLARE
        v_entry_id integer;
        v_debit numeric(18,4);
        v_credit numeric(18,4);
      BEGIN
        v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

        -- the parent entry may have been deleted along with its lines
        IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_entry_id) THEN
          RETURN NULL;
        END IF;

        SELECT COALESCE(sum(debit_usd), 0), COALESCE(sum(credit_usd), 0)
          INTO v_debit, v_credit
          FROM journal_lines WHERE entry_id = v_entry_id;

        IF round(v_debit, 4) <> round(v_credit, 4) THEN
          RAISE EXCEPTION
            'journal entry % does not balance: debit % <> credit %',
            v_entry_id, v_debit, v_credit;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
      AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();
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

    // --- T5: payment recorded (cash-basis, C5a) --------------------------------------------
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
              'over-payment on %: % already paid + % exceeds the % total',
              v_po.po_number, v_paid, NEW.amount_usd, v_po.total_usd;
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

    // --- T6: C2, no self-approval ------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_pr_self_approval() RETURNS trigger AS $$
      BEGIN
        IF NEW.status IN ('approved', 'rejected')
           AND OLD.status IS DISTINCT FROM NEW.status
           AND NEW.approver_id IS NOT NULL
           AND NEW.approver_id = NEW.requester_id THEN
          RAISE EXCEPTION
            'a purchase request cannot be decided by its own requester (user %)',
            NEW.requester_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_requests_guard_self_approval"
      BEFORE UPDATE OF status ON "purchase_requests"
      FOR EACH ROW EXECUTE FUNCTION guard_pr_self_approval();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "purchase_requests_guard_self_approval" ON "purchase_requests"`,
    );
    await queryRunner.query(`DROP FUNCTION guard_pr_self_approval()`);
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
    await queryRunner.query(
      `DROP TRIGGER "journal_lines_balanced" ON "journal_lines"`,
    );
    await queryRunner.query(`DROP FUNCTION assert_journal_entry_balanced()`);
    await queryRunner.query(
      `DROP TRIGGER "purchase_orders_derive_total_usd" ON "purchase_orders"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "purchase_requests_derive_total_usd" ON "purchase_requests"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "payments_derive_amount_usd" ON "payments"`,
    );
    await queryRunner.query(`DROP FUNCTION derive_total_usd()`);
    await queryRunner.query(`DROP FUNCTION derive_amount_usd()`);
    await queryRunner.query(`DROP FUNCTION app_setting_numeric(text, numeric)`);

    const updatedAtTables = [
      'app_settings',
      'departments',
      'projects',
      'suppliers',
      'accounts',
      'journal_entries',
      'exchange_rates',
      'budgets',
      'categories',
      'inventory_items',
      'inventory_claims',
      'stock_requests',
      'purchase_requests',
      'purchase_orders',
      'payments',
    ];
    for (const table of updatedAtTables) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_set_updated_at" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION set_updated_at()`);
  }
}
