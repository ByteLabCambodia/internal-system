import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { textRow } from '../prisma/raw';
import { User } from '../users/domain/user';

export type ActivityFeedItem = {
  kind: string;
  label: string;
  href: string;
  detail: string;
  status: string | null;
  /** Postgres timestamptz text; the view parses it. */
  createdAt: string;
};

/**
 * Everything the dashboard shows, in as few queries as it takes. KPIs are per-actor where
 * the underlying resource is (my pending requests), and global where it is not (low stock).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  async kpis(actor: User): Promise<{
    myPendingRequests: number;
    lowStockItems: number;
    openPurchaseOrders: number;
  }> {
    const orm = this.db.orm.public;

    const [mine, lowStock, open] = await Promise.all([
      orm.PurchaseRequest.where({ requesterId: Number(actor.id) })
        .where((pr) => pr.status.in(['draft', 'pending']))
        .aggregate((a) => ({ count: a.count() })),
      orm.InventoryItem.where({ active: true })
        .where((item) => item.stockQty.lte(item.reorderPoint))
        .aggregate((a) => ({ count: a.count() })),
      orm.PurchaseOrder.where((po) =>
        po.status.in(['open', 'partial']),
      ).aggregate((a) => ({ count: a.count() })),
    ]);

    const myPendingRequests = mine.count;
    const lowStockItems = lowStock.count;
    const openPurchaseOrders = open.count;

    return { myPendingRequests, lowStockItems, openPurchaseOrders };
  }

  /** The three charts, as plain JSON embedded in the template for Chart.js. */
  async charts(): Promise<{
    profitAndLoss: { labels: string[]; income: number[]; expense: number[] };
    expenseByCategory: { labels: string[]; values: number[] };
    expenseByDepartment: { labels: string[]; values: number[] };
  }> {
    const pnl = await this.db.runtime().query(
      this.db.raw.sql`
      SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS month,
             COALESCE(SUM(CASE WHEN a.type = 'income'  THEN l.credit_usd - l.debit_usd END), 0)::text AS income,
             COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit_usd - l.credit_usd END), 0)::text AS expense
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN accounts a ON a.id = l.account_id
       WHERE a.type IN ('income', 'expense')
         AND e.entry_date >= date_trunc('month', current_date) - interval '11 months'
       GROUP BY 1 ORDER BY 1
    `
        .returnsRow(textRow('month', 'income', 'expense'))
        .build(),
    );

    const byCategory = await this.db.runtime().query(
      this.db.raw.sql`
      SELECT a.name AS label, COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
        FROM journal_lines l
        JOIN accounts a ON a.id = l.account_id
       WHERE a.type = 'expense'
       GROUP BY a.name HAVING COALESCE(SUM(l.debit_usd - l.credit_usd), 0) <> 0
       ORDER BY 2 DESC LIMIT 8
    `
        .returnsRow(textRow('label', 'total'))
        .build(),
    );

    const byDepartment = await this.db.runtime().query(
      this.db.raw.sql`
      SELECT COALESCE(d.name, 'Unassigned') AS label,
             COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
        FROM journal_lines l
        JOIN accounts a ON a.id = l.account_id
   LEFT JOIN departments d ON d.id = l.dimension_department_id
       WHERE a.type = 'expense'
       GROUP BY 1 HAVING COALESCE(SUM(l.debit_usd - l.credit_usd), 0) <> 0
       ORDER BY 2 DESC LIMIT 8
    `
        .returnsRow(textRow('label', 'total'))
        .build(),
    );

    return {
      profitAndLoss: {
        labels: pnl.map((row) => row.month),
        income: pnl.map((row) => Number(row.income)),
        expense: pnl.map((row) => Number(row.expense)),
      },
      expenseByCategory: {
        labels: byCategory.map((row) => row.label),
        values: byCategory.map((row) => Number(row.total)),
      },
      expenseByDepartment: {
        labels: byDepartment.map((row) => row.label),
        values: byDepartment.map((row) => Number(row.total)),
      },
    };
  }

  /** Recent orders, payments, claims and stock requests, newest first. */
  async activityFeed(limit = 12): Promise<ActivityFeedItem[]> {
    const rows = await this.db.runtime().query(
      this.db.raw.sql`(SELECT 'Purchase order' AS kind, po.po_number AS label,
               '/purchase-orders/' || po.id AS href,
               COALESCE(s.name, po.supplier, '') AS detail,
               po.status::text AS status, po.created_at
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id)
       UNION ALL
       (SELECT 'Payment', COALESCE(po.po_number, 'Direct expense'),
               COALESCE('/purchase-orders/' || po.id, '/accounting'),
               to_char(p.amount_usd, 'FM999999990.00') || ' USD',
               NULL, p.created_at
          FROM payments p LEFT JOIN purchase_orders po ON po.id = p.po_id)
       UNION ALL
       (SELECT 'Claim', COALESCE(i.name, 'Goods'), '/claims',
               rtrim(to_char(c.qty_claimed, 'FM999999990.9999'), '.') || ' received',
               c.status::text, c.created_at
          FROM inventory_claims c LEFT JOIN inventory_items i ON i.id = c.inventory_item_id)
       UNION ALL
       (SELECT 'Stock request', COALESCE(i.name, 'Item'),
               '/stock-requests/' || r.id,
               rtrim(to_char(r.qty, 'FM999999990.9999'), '.') || ' requested',
               r.status::text, r.created_at
          FROM stock_requests r LEFT JOIN inventory_items i ON i.id = r.inventory_item_id)
       ORDER BY created_at DESC
       LIMIT ${limit}`
        .returnsRow({
          ...textRow('kind', 'label', 'href', 'detail', 'status'),
          created_at: 'pg/timestamptz-string@1',
        })
        .build(),
    );

    return rows.map((row) => ({
      kind: row.kind,
      label: row.label,
      href: row.href,
      detail: row.detail,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  /** The notifications panel: this user's unread rows, newest first. */
  async notifications(actor: User, limit = 8) {
    return await this.db.orm.public.Notification.where({
      userId: Number(actor.id),
      read: false,
    })
      .orderBy([(n) => n.createdAt.desc(), (n) => n.id.desc()])
      .limit(limit)
      .all();
  }

  /** Requests waiting on this actor's decision — only meaningful for approvers. */
  async pendingApprovals(): Promise<number> {
    const { count } = await this.db.orm.public.PurchaseRequest.where({
      status: 'pending',
    }).aggregate((a) => ({ count: a.count() }));

    return count;
  }
}
