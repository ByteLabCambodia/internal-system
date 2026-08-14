import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type DateRange = { from?: string; to?: string };

export type ReportRow = Record<string, string | number | null>;

export type Report = {
  key: string;
  title: string;
  description: string;
  columns: { key: string; label: string; align?: 'right' }[];
  rows: ReportRow[];
};

/**
 * The eight reports from Part 1 §2.5 plus spend-by-supplier (C4).
 *
 * Every money figure comes from `journal_lines`, which holds USD converted at the rate
 * locked on the record at the time — never today's rate. The reports that read `payments`
 * or `purchase_orders` directly (currency summary, PO summary, spend by supplier) are
 * deliberately about the original-currency documents rather than the ledger.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Inclusive date bounds against a column, as a WHERE fragment plus its parameters. */
  private range(column: string, range: DateRange, startIndex = 1) {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (range.from) {
      params.push(range.from);
      clauses.push(`${column} >= $${startIndex + params.length - 1}`);
    }
    if (range.to) {
      params.push(range.to);
      clauses.push(`${column} <= $${startIndex + params.length - 1}`);
    }

    return {
      sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  async profitAndLoss(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('e.entry_date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS month,
              COALESCE(SUM(CASE WHEN a.type = 'income'  THEN l.credit_usd - l.debit_usd END), 0)::text AS income,
              COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit_usd - l.credit_usd END), 0)::text AS expense,
              (COALESCE(SUM(CASE WHEN a.type = 'income'  THEN l.credit_usd - l.debit_usd END), 0)
             - COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit_usd - l.credit_usd END), 0))::text AS net
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.type IN ('income', 'expense') ${sql}
        GROUP BY 1
        ORDER BY 1`,
      params,
    );

    return {
      key: 'profit-and-loss',
      title: 'Profit & loss by month',
      description:
        'Income against expense, from the ledger, at each record’s locked rate.',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'income', label: 'Income', align: 'right' },
        { key: 'expense', label: 'Expense', align: 'right' },
        { key: 'net', label: 'Net', align: 'right' },
      ],
      rows,
    };
  }

  async cashFlow(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('e.entry_date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS month,
              COALESCE(SUM(l.debit_usd), 0)::text  AS inflow,
              COALESCE(SUM(l.credit_usd), 0)::text AS outflow,
              COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS net
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.code = '1000' ${sql}
        GROUP BY 1
        ORDER BY 1`,
      params,
    );

    return {
      key: 'cash-flow',
      title: 'Cash flow by month',
      description: 'Movement through 1000 Cash / Bank.',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'inflow', label: 'In', align: 'right' },
        { key: 'outflow', label: 'Out', align: 'right' },
        { key: 'net', label: 'Net', align: 'right' },
      ],
      rows,
    };
  }

  /** The C1 acceptance test: this returns one row per expense account actually used. */
  async expenseByCategory(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('e.entry_date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT a.code, a.name AS account,
              COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.type = 'expense' ${sql}
        GROUP BY a.code, a.name
       HAVING COALESCE(SUM(l.debit_usd - l.credit_usd), 0) <> 0
        ORDER BY 3 DESC`,
      params,
    );

    return {
      key: 'expense-by-category',
      title: 'Expense by category',
      description:
        'Grouped by the expense account each purchase resolved to (C1). More than one row here means the category mapping is working.',
      columns: [
        { key: 'code', label: 'Account' },
        { key: 'account', label: 'Name' },
        { key: 'total', label: 'Total USD', align: 'right' },
      ],
      rows,
    };
  }

  async expenseByDepartment(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('e.entry_date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT COALESCE(d.name, 'Unassigned') AS department,
              COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
    LEFT JOIN departments d ON d.id = l.dimension_department_id
        WHERE a.type = 'expense' ${sql}
        GROUP BY 1
       HAVING COALESCE(SUM(l.debit_usd - l.credit_usd), 0) <> 0
        ORDER BY 2 DESC`,
      params,
    );

    return {
      key: 'expense-by-department',
      title: 'Expense by department',
      description:
        'Using the department dimension carried on each journal line.',
      columns: [
        { key: 'department', label: 'Department' },
        { key: 'total', label: 'Total USD', align: 'right' },
      ],
      rows,
    };
  }

  async currencySummary(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('p.paid_at::date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT p.currency,
              COUNT(*)::text AS payments,
              COALESCE(SUM(p.amount_original), 0)::text AS total_original,
              COALESCE(SUM(p.amount_usd), 0)::text AS total_usd
         FROM payments p
        WHERE true ${sql}
        GROUP BY p.currency
        ORDER BY 4 DESC`,
      params,
    );

    return {
      key: 'currency-summary',
      title: 'Currency summary',
      description:
        'Payments by currency, showing the original amount beside the USD it converted to.',
      columns: [
        { key: 'currency', label: 'Currency' },
        { key: 'payments', label: 'Payments', align: 'right' },
        { key: 'total_original', label: 'Total original', align: 'right' },
        { key: 'total_usd', label: 'Total USD', align: 'right' },
      ],
      rows,
    };
  }

  async purchaseOrderSummary(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('po.created_at::date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT po.status::text, po.payment_status::text AS payment_status,
              COUNT(*)::text AS orders,
              COALESCE(SUM(po.total_usd), 0)::text AS total_usd
         FROM purchase_orders po
        WHERE true ${sql}
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      params,
    );

    return {
      key: 'po-summary',
      title: 'Purchase order summary',
      description: 'Orders by status and payment status.',
      columns: [
        { key: 'status', label: 'Status' },
        { key: 'payment_status', label: 'Payment' },
        { key: 'orders', label: 'Orders', align: 'right' },
        { key: 'total_usd', label: 'Total USD', align: 'right' },
      ],
      rows,
    };
  }

  async transactionHistory(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('e.entry_date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT to_char(e.entry_date, 'YYYY-MM-DD') AS date,
              e.memo, e.source::text,
              a.code || ' ' || a.name AS account,
              l.debit_usd::text, l.credit_usd::text
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE true ${sql}
        ORDER BY e.entry_date DESC, e.id DESC, l.id ASC
        LIMIT 1000`,
      params,
    );

    return {
      key: 'transaction-history',
      title: 'Transaction history',
      description: 'Every journal line, newest first (capped at 1,000 rows).',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'memo', label: 'Memo' },
        { key: 'source', label: 'Source' },
        { key: 'account', label: 'Account' },
        { key: 'debit_usd', label: 'Debit', align: 'right' },
        { key: 'credit_usd', label: 'Credit', align: 'right' },
      ],
      rows,
    };
  }

  async budgetVsActual(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('b.period', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT to_char(b.period, 'YYYY-MM') AS period,
              COALESCE(d.name, 'Unassigned') AS department,
              COALESCE(b.category, 'All') AS category,
              b.amount_usd::text AS budget,
              COALESCE((
                SELECT SUM(l.debit_usd - l.credit_usd)
                  FROM journal_lines l
                  JOIN journal_entries e ON e.id = l.entry_id
                  JOIN accounts a ON a.id = l.account_id
                 WHERE a.type = 'expense'
                   AND date_trunc('month', e.entry_date) = date_trunc('month', b.period)
                   AND (b.department_id IS NULL OR l.dimension_department_id = b.department_id)
              ), 0)::text AS actual
         FROM budgets b
    LEFT JOIN departments d ON d.id = b.department_id
        WHERE true ${sql}
        ORDER BY b.period DESC, 2`,
      params,
    );

    return {
      key: 'budget-vs-actual',
      title: 'Budget vs actual',
      description:
        'Budgets are not written by any screen yet — this reports whatever rows exist in the table.',
      columns: [
        { key: 'period', label: 'Month' },
        { key: 'department', label: 'Department' },
        { key: 'category', label: 'Category' },
        { key: 'budget', label: 'Budget USD', align: 'right' },
        { key: 'actual', label: 'Actual USD', align: 'right' },
      ],
      rows,
    };
  }

  /** C4: the view that free-text suppliers made impossible. */
  async spendBySupplier(range: DateRange): Promise<Report> {
    const { sql, params } = this.range('po.created_at::date', range);

    const rows = await this.dataSource.query<ReportRow[]>(
      `SELECT COALESCE(s.name, po.supplier, 'Unassigned') AS supplier,
              COUNT(*)::text AS orders,
              COALESCE(SUM(po.total_usd), 0)::text AS total_usd,
              to_char(MAX(po.created_at), 'YYYY-MM-DD') AS last_order
         FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status <> 'cancelled' ${sql}
        GROUP BY 1
        ORDER BY 3 DESC`,
      params,
    );

    return {
      key: 'spend-by-supplier',
      title: 'Spend by supplier',
      description: 'Order count, total USD and last order date per supplier.',
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'orders', label: 'Orders', align: 'right' },
        { key: 'total_usd', label: 'Total USD', align: 'right' },
        { key: 'last_order', label: 'Last order' },
      ],
      rows,
    };
  }

  private readonly builders: Record<
    string,
    (range: DateRange) => Promise<Report>
  > = {
    'profit-and-loss': (range) => this.profitAndLoss(range),
    'cash-flow': (range) => this.cashFlow(range),
    'expense-by-category': (range) => this.expenseByCategory(range),
    'expense-by-department': (range) => this.expenseByDepartment(range),
    'currency-summary': (range) => this.currencySummary(range),
    'po-summary': (range) => this.purchaseOrderSummary(range),
    'transaction-history': (range) => this.transactionHistory(range),
    'budget-vs-actual': (range) => this.budgetVsActual(range),
    'spend-by-supplier': (range) => this.spendBySupplier(range),
  };

  get keys(): string[] {
    return Object.keys(this.builders);
  }

  build(key: string, range: DateRange): Promise<Report> | null {
    const builder = this.builders[key];
    return builder ? builder(range) : null;
  }
}
