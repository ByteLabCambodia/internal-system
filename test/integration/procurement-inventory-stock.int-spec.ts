import { TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  q,
  seedPurchaseOrder,
  seedRoles,
  seedStockRequest,
  seedWorld,
  World,
} from './support/fixtures';
import { PurchaseRequestsService } from '../../src/procurement/purchase-requests.service';
import { PurchaseOrdersService } from '../../src/procurement/purchase-orders.service';
import { PaymentsService } from '../../src/procurement/payments.service';
import { ClaimsService } from '../../src/inventory/claims.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { CategoriesService } from '../../src/inventory/categories.service';
import { StockRequestsService } from '../../src/stock/stock-requests.service';
import {
  CurrencyEnum,
  PoTypeEnum,
  PrStatusEnum,
  StockPriorityEnum,
} from '../../src/common/enums';
import { User } from '../../src/users/domain/user';

/**
 * Procurement, inventory and stock after the move to Prisma: the list screens (scoping,
 * search, filters, sorting, paging), the detail reads the views rely on, and the
 * create/decide/cancel paths the trigger-era suites did not cover.
 */
describe('procurement, inventory and stock on Prisma', () => {
  let app: TestingModule;
  let db: DataSource;
  let world: World;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
  });

  const page = { page: 1, limit: 20 };

  describe('PurchaseRequestsService', () => {
    let requests: PurchaseRequestsService;
    beforeEach(() => (requests = app.get(PurchaseRequestsService)));

    const create = (actor: User, note: string, price = 5, submit = true) =>
      requests.create(
        actor,
        {
          currency: CurrencyEnum.USD,
          departmentId: world.departmentId,
          note,
          items: [
            { name: 'Paper', qty: 2, unitPrice: price, category: 'Supplies' },
            { name: 'Pens', qty: 1, unitPrice: 1 },
          ],
        } as never,
        submit,
      );

    it('should create a request with its lines and return the detail the view reads', async () => {
      const pr = await create(world.employee, 'For the office');

      expect(pr).toMatchObject({
        prNumber: 'PR-0001',
        status: 'pending',
        totalOriginal: '11.0000',
        totalUsd: '11.0000',
        exchangeRate: '1.000000',
        note: 'For the office',
        requester: { id: world.employee.id, firstName: 'employee' },
        department: { name: 'Ops' },
        project: null,
        approver: null,
      });
      expect(pr.items.map((i) => [i.name, i.qty, i.category])).toEqual([
        ['Paper', '2.0000', 'Supplies'],
        ['Pens', '1.0000', null],
      ]);
    });

    it('should lock a foreign currency to the day’s rate and refuse one with no rate', async () => {
      const pr = await requests.create(
        world.employee,
        {
          currency: CurrencyEnum.KHR,
          items: [{ name: 'Tea', qty: 1, unitPrice: 4000 }],
        } as never,
        false,
      );
      expect(pr).toMatchObject({
        status: 'draft',
        exchangeRate: '4000.000000',
        totalUsd: '1.0000',
      });

      await expect(
        requests.create(
          world.employee,
          {
            currency: CurrencyEnum.CNY,
            items: [{ name: 'Tea', qty: 1, unitPrice: 1 }],
          } as never,
          true,
        ),
      ).rejects.toThrow('No exchange rate on file for CNY');
    });

    it('should scope the list to the requester unless the actor sees all rows', async () => {
      await create(world.employee, 'mine');
      await create(world.manager, 'theirs');

      const own = await requests.list(world.employee, page);
      expect(own.count).toBe(1);
      expect(own.rows.map((r) => r.note)).toEqual(['mine']);
      expect(own.rows[0].requester.firstName).toBe('employee');

      const all = await requests.list(world.manager, page);
      expect(all.count).toBe(2);

      await expect(
        requests.findOneForActor(world.employee, all.rows[0].id),
      ).rejects.toThrow(NotFoundException); // the manager's request
    });

    it('should search number and note, treating % literally, and filter by status', async () => {
      await create(world.employee, 'Toner 100% black');
      await create(world.employee, 'Toner 1000 sheets');
      const draft = await create(world.employee, 'Chairs', 5, false);

      const search = (term: string) =>
        requests
          .list(world.manager, { ...page, search: term })
          .then((r) => r.rows.map((row) => row.note).sort());

      expect(await search('toner')).toEqual([
        'Toner 100% black',
        'Toner 1000 sheets',
      ]);
      expect(await search('100%')).toEqual(['Toner 100% black']);
      expect(await search('pr-0003')).toEqual(['Chairs']);

      const drafts = await requests.list(world.manager, {
        ...page,
        status: PrStatusEnum.draft,
      });
      expect(drafts.rows.map((r) => r.id)).toEqual([draft.id]);
    });

    it('should filter by an inclusive date range, sort and page', async () => {
      const a = await create(world.employee, 'a', 1);
      const b = await create(world.employee, 'b', 30);
      const c = await create(world.employee, 'c', 10);
      // Zone-less literals read in the session time zone, which both pools share: the
      // first and last instants of the range, and the first instant after it.
      await db.query(
        `UPDATE purchase_requests SET created_at = CASE id
           WHEN $1 THEN '2026-01-10 00:00:00'::timestamp
           WHEN $2 THEN '2026-01-20 23:59:59'::timestamp
           ELSE '2026-01-21 00:00:00'::timestamp END`,
        [a.id, b.id],
      );

      const inRange = await requests.list(world.manager, {
        ...page,
        from: '2026-01-10',
        to: '2026-01-20',
      });
      expect(inRange.rows.map((r) => r.note).sort()).toEqual(['a', 'b']);

      const byTotal = await requests.list(world.manager, {
        ...page,
        orderBy: 'total_usd',
        order: 'asc',
      });
      expect(byTotal.rows.map((r) => r.note)).toEqual(['a', 'c', 'b']);

      const second = await requests.list(world.manager, {
        page: 2,
        limit: 2,
        orderBy: 'total_usd',
        order: 'desc',
      });
      expect(second.count).toBe(3);
      expect(second.rows.map((r) => r.note)).toEqual(['a']);

      // An unknown sort key falls back to newest first instead of reaching SQL.
      const fallback = await requests.list(world.manager, {
        ...page,
        orderBy: 'password',
      });
      expect(fallback.rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    });

    it('should submit a draft, then approve it within the actor’s limit', async () => {
      const draft = await create(world.employee, 'draft', 5, false);
      await expect(
        requests.submit(world.employee, draft.id),
      ).resolves.toMatchObject({
        status: 'pending',
      });
      await expect(requests.submit(world.employee, draft.id)).rejects.toThrow(
        'Only a draft request can be submitted.',
      );

      await db.query(
        `INSERT INTO approval_thresholds (role_id, max_amount_usd) VALUES (2, NULL)`,
      );
      const decided = await requests.decide(
        world.manager,
        draft.id,
        'approved',
      );

      expect(decided).toMatchObject({
        status: 'approved',
        approver: { id: world.manager.id },
      });
      expect(decided.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    });

    it('should refuse an approval above the actor’s limit', async () => {
      const pr = await create(world.employee, 'big', 500);
      await db.query(
        `INSERT INTO approval_thresholds (role_id, max_amount_usd) VALUES (2, 100), (1, NULL)`,
      );

      await expect(
        requests.decide(world.manager, pr.id, 'approved'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        requests.decide(world.manager, pr.id, 'rejected'),
      ).resolves.toMatchObject({ status: 'rejected' });
    });

    it('should cancel and delete only in the allowed states, deleting the lines too', async () => {
      const pr = await create(world.employee, 'gone');
      await requests.cancel(world.employee, pr.id);
      await expect(requests.cancel(world.employee, pr.id)).rejects.toThrow(
        'A cancelled request cannot be cancelled.',
      );

      await requests.remove(world.employee, pr.id);
      expect(
        await db.query(
          `SELECT 1 FROM purchase_request_items WHERE pr_id = $1`,
          [pr.id],
        ),
      ).toHaveLength(0);

      const approved = await create(world.employee, 'kept');
      await db.query(
        `UPDATE purchase_requests SET status = 'approved' WHERE id = $1`,
        [approved.id],
      );
      await expect(
        requests.remove(world.employee, approved.id),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should list only approved requests as convertible, with lines in order', async () => {
      const approved = await create(world.employee, 'ready');
      await create(world.employee, 'pending');
      await db.query(
        `UPDATE purchase_requests SET status = 'approved' WHERE id = $1`,
        [approved.id],
      );

      const convertible = await requests.findConvertible();
      expect(convertible.map((pr) => pr.id)).toEqual([approved.id]);
      expect(convertible[0].items.map((i) => i.name)).toEqual([
        'Paper',
        'Pens',
      ]);
      expect(convertible[0].requester.id).toBe(world.employee.id);
    });
  });

  describe('PurchaseOrdersService', () => {
    let orders: PurchaseOrdersService;
    let requests: PurchaseRequestsService;
    beforeEach(() => {
      orders = app.get(PurchaseOrdersService);
      requests = app.get(PurchaseRequestsService);
    });

    async function approvedRequest(category: string | null = 'Supplies') {
      const pr = await requests.create(
        world.employee,
        {
          currency: CurrencyEnum.KHR,
          departmentId: world.departmentId,
          projectId: world.projectId,
          items: [
            { name: 'Paper', qty: 2, unitPrice: 8000, category },
            { name: 'Pens', qty: 1, unitPrice: 4000, category },
          ],
        } as never,
        true,
      );
      await db.query(
        `UPDATE purchase_requests SET status = 'approved' WHERE id = $1`,
        [pr.id],
      );
      return pr;
    }

    const order = (prId: number, extra = {}) => ({
      prId,
      type: PoTypeEnum.online,
      items: [{ name: 'Paper', qtyOrdered: 2, unitPrice: 8000 }],
      ...extra,
    });

    it('should raise an order from an approved request and convert the request', async () => {
      await db.query(
        `INSERT INTO categories (name, expense_account_id) VALUES ('Supplies', $1)`,
        [world.accounts.supplies],
      );
      const pr = await approvedRequest();

      const po = await orders.createFromRequest(
        world.manager,
        order(pr.id, { supplierName: '  Acme Co ' }) as never,
      );

      expect(po).toMatchObject({
        poNumber: 'PO-0001',
        currency: 'KHR',
        exchangeRate: '4000.000000', // the request's locked rate
        totalOriginal: '16000.0000',
        totalUsd: '4.0000',
        status: 'open',
        paymentStatus: 'unpaid',
        supplierRecord: { name: 'Acme Co' },
        supplierName: 'Acme Co',
        expenseAccount: { code: '6100' }, // C1: the shared category's account
        department: { name: 'Ops' },
        project: { name: 'Fit-out' },
        createdBy: { id: world.manager.id },
        purchaseRequest: { id: pr.id, requester: { id: world.employee.id } },
      });
      expect(po.items.map((i) => [i.name, i.qtyOrdered, i.qtyClaimed])).toEqual(
        [['Paper', '2.0000', '0.0000']],
      );

      const after = await q(
        db,
        `SELECT status FROM purchase_requests WHERE id = $1`,
        [pr.id],
      );
      expect(after.status).toBe('converted');
    });

    it('should fall back to 6900 for mixed or unmapped categories, and honour an override', async () => {
      const mixed = await requests.create(
        world.employee,
        {
          currency: CurrencyEnum.USD,
          items: [
            { name: 'A', qty: 1, unitPrice: 1, category: 'Supplies' },
            { name: 'B', qty: 1, unitPrice: 1, category: 'Travel' },
          ],
        } as never,
        true,
      );
      await db.query(`UPDATE purchase_requests SET status = 'approved'`);

      expect(
        (
          await orders.createFromRequest(
            world.manager,
            order(mixed.id) as never,
          )
        ).expenseAccount?.code,
      ).toBe('6900');

      const pr = await approvedRequest();
      expect(
        (
          await orders.createFromRequest(
            world.manager,
            order(pr.id, {
              expenseAccountId: world.accounts.supplies,
            }) as never,
          )
        ).expenseAccount?.code,
      ).toBe('6100');
    });

    it('should refuse to raise an order from a request that is not approved', async () => {
      const pr = await requests.create(
        world.employee,
        {
          currency: CurrencyEnum.USD,
          items: [{ name: 'A', qty: 1, unitPrice: 1 }],
        } as never,
        true,
      );

      await expect(
        orders.createFromRequest(world.manager, order(pr.id) as never),
      ).rejects.toThrow(
        'is pending; only an approved request can become an order',
      );
      await expect(
        orders.createFromRequest(world.manager, order(9999) as never),
      ).rejects.toThrow(NotFoundException);
      expect(await db.query(`SELECT 1 FROM purchase_orders`)).toHaveLength(0);
    });

    it('should search supplier names through the supplier record and the legacy text', async () => {
      const linked = await approvedRequest();
      await orders.createFromRequest(
        world.manager,
        order(linked.id, { supplierName: 'Beta Traders' }) as never,
      );
      await seedPurchaseOrder(db, world, { lines: [[null, '1', '1']] }); // supplier text 'Acme'

      const search = (term: string) =>
        orders
          .list(world.manager, { ...page, search: term })
          .then((r) =>
            r.rows.map((row) => row.supplierRecord?.name ?? row.supplierName),
          );

      expect(await search('beta')).toEqual(['Beta Traders']);
      expect(await search('acme')).toEqual(['Acme']);
      expect(await search('PO-0002')).toEqual(['Acme']);
    });

    it('should scope orders to their creator for employees', async () => {
      await seedPurchaseOrder(db, world, { lines: [[null, '1', '1']] }); // created by manager

      expect((await orders.list(world.employee, page)).count).toBe(0);
      expect((await orders.list(world.finance, page)).count).toBe(1);
    });

    it('should cancel an open order but not a complete or cancelled one', async () => {
      const open = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '1']],
      });
      const complete = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '1']],
        status: 'complete',
      });

      await orders.cancel(world.manager, open.poId);
      await expect(orders.cancel(world.manager, open.poId)).rejects.toThrow(
        'already cancelled',
      );
      await expect(orders.cancel(world.manager, complete.poId)).rejects.toThrow(
        'A completed order cannot be cancelled.',
      );
    });

    it('should offer only open, unpaid-or-partial orders for payment', async () => {
      const open = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      const paid = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
        status: 'cancelled',
      });
      await db.query(
        `UPDATE purchase_orders SET payment_status = 'paid' WHERE id = $1`,
        [paid.poId],
      );

      expect((await orders.findPayable()).map((po) => po.id)).toEqual([
        open.poId,
      ]);
    });

    it('should list an order’s payments newest first with who recorded them', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      const payments = app.get(PaymentsService);
      await payments.record(world.finance, {
        poId: po.poId,
        amountOriginal: 3,
        currency: CurrencyEnum.USD,
        paidAt: '2026-01-01',
      } as never);
      const latest = await payments.record(world.finance, {
        poId: po.poId,
        amountOriginal: 4,
        currency: CurrencyEnum.USD,
      } as never);

      expect(latest).toMatchObject({
        amountUsd: '4.0000',
        purchaseOrder: { id: po.poId },
        recordedBy: { id: world.finance.id },
        journalEntry: { source: 'po_payment' },
      });

      const listed = await payments.listForOrder(po.poId);
      expect(listed.map((p) => p.amountUsd)).toEqual(['4.0000', '3.0000']);
      expect(listed[0].recordedBy?.firstName).toBe('finance');
    });
  });

  describe('ClaimsService', () => {
    let claims: ClaimsService;
    beforeEach(() => (claims = app.get(ClaimsService)));

    it('should file a claim against the line’s catalog item and tell the claimant what is left', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[world.itemA, '10', '1']],
      });

      const claim = await claims.create(world.employee, {
        poItemId: po.lineIds[0],
        qtyClaimed: 4,
      });
      expect(claim).toMatchObject({
        poId: po.poId,
        poItemId: po.lineIds[0],
        inventoryItemId: world.itemA,
        qtyClaimed: '4.0000',
        status: 'pending',
        claimedById: world.employee.id,
      });

      await claims.confirm(world.manager, claim.id);
      await expect(
        claims.create(world.employee, {
          poItemId: po.lineIds[0],
          qtyClaimed: 7,
        }),
      ).rejects.toThrow(
        'Only 6.0000 of Line 1 is still outstanding on this order.',
      );
    });

    it('should ask which item to receive into when the line has none', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '1']],
      });

      await expect(
        claims.create(world.employee, {
          poItemId: po.lineIds[0],
          qtyClaimed: 1,
        }),
      ).rejects.toThrow('not linked to a catalog item');
      await expect(
        claims.create(world.employee, { poItemId: 9999, qtyClaimed: 1 }),
      ).rejects.toThrow('Choose the purchase order line');
    });

    it('should list claims with their item, order and people, scoped to the claimant', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[world.itemA, '10', '1']],
      });
      const mine = await claims.create(world.employee, {
        poItemId: po.lineIds[0],
        qtyClaimed: 1,
      });
      await claims.create(world.manager, {
        poItemId: po.lineIds[0],
        qtyClaimed: 1,
      });
      await claims.reject(world.manager, mine.id);

      const own = await claims.list(world.employee, page);
      expect(own.count).toBe(1);
      expect(own.rows[0]).toMatchObject({
        status: 'rejected',
        inventoryItem: { sku: 'SKU-A' },
        purchaseOrder: { poNumber: po.poNumber },
        claimedBy: { firstName: 'employee' },
        confirmedBy: { firstName: 'manager' },
      });

      expect((await claims.list(world.manager, page)).count).toBe(2);
      expect(
        (
          await claims.list(world.manager, {
            ...page,
            status: 'pending' as never,
          })
        ).count,
      ).toBe(1);

      await expect(claims.reject(world.manager, mine.id)).rejects.toThrow(
        'This claim is already rejected.',
      );
    });

    it('should offer only lines with something outstanding on orders that are not cancelled', async () => {
      const open = await seedPurchaseOrder(db, world, {
        lines: [
          [world.itemA, '5', '1'],
          [world.itemB, '5', '1'],
        ],
      });
      await seedPurchaseOrder(db, world, {
        lines: [[world.itemA, '5', '1']],
        status: 'cancelled',
      });
      await db.query(
        `UPDATE purchase_order_items SET qty_claimed = qty_ordered WHERE id = $1`,
        [open.lineIds[1]],
      );

      const lines = await claims.claimableLines();
      expect(lines.map((l) => l.id)).toEqual([open.lineIds[0]]);
      expect(lines[0]).toMatchObject({
        purchaseOrder: { poNumber: open.poNumber },
        inventoryItem: { id: world.itemA },
      });
    });
  });

  describe('InventoryService and CategoriesService', () => {
    let inventory: InventoryService;
    let categories: CategoriesService;
    beforeEach(() => {
      inventory = app.get(InventoryService);
      categories = app.get(CategoriesService);
    });

    it('should create and update items, refusing a SKU that exists in any case', async () => {
      const item = await inventory.create(world.manager, {
        sku: ' PAPER-A4 ',
        name: 'A4 paper',
        reorderPoint: 5,
        reorderQty: 20,
      } as never);
      expect(item).toMatchObject({
        sku: 'PAPER-A4',
        unit: 'pcs',
        stockQty: '0.0000',
        reorderPoint: '5.0000',
        active: true,
      });

      await expect(
        inventory.create(world.manager, {
          sku: 'paper-a4',
          name: 'x',
        } as never),
      ).rejects.toThrow('SKU paper-a4 already belongs to A4 paper.');

      await inventory.update(world.manager, item.id, {
        sku: 'PAPER-A4',
        name: 'A4 copy paper',
        unit: 'ream',
        active: 'false',
      } as never);
      expect(await inventory.findById(item.id)).toMatchObject({
        name: 'A4 copy paper',
        unit: 'ream',
        reorderPoint: '0.0000',
        stockQty: '0.0000',
        active: false,
      });
    });

    it('should search, filter low stock and sort the catalog', async () => {
      await db.query(
        `UPDATE inventory_items SET reorder_point = 10 WHERE sku = 'SKU-A'`,
      ); // 10 on hand: at the point

      const skus = (filters = {}) =>
        inventory
          .list({ ...page, ...filters })
          .then((r) => r.rows.map((i) => i.sku));

      expect(await skus({ search: 'sku-b' })).toEqual(['SKU-B']);
      expect(await skus({ search: 'item' })).toEqual(['SKU-A', 'SKU-B']);
      expect(await skus({ lowStock: true })).toEqual(['SKU-A', 'SKU-B']);
      await db.query(
        `UPDATE inventory_items SET reorder_point = 9 WHERE sku = 'SKU-A'`,
      );
      expect(await skus({ lowStock: true })).toEqual(['SKU-B']);
      expect(await skus({ orderBy: 'stock_qty', order: 'desc' })).toEqual([
        'SKU-A',
        'SKU-B',
      ]);
      expect((await inventory.lowStock()).map((i) => i.sku)).toEqual(['SKU-B']);
      expect((await inventory.findActive()).map((i) => i.sku)).toEqual([
        'SKU-A',
        'SKU-B',
      ]);
    });

    it('should adjust stock through the ledger and refuse to go negative', async () => {
      expect(
        await inventory.adjustStock(world.manager, world.itemA, '-3'),
      ).toBe('7.0000');
      await expect(
        inventory.adjustStock(world.manager, world.itemA, '-8'),
      ).rejects.toThrow('That would take SKU-A to -1.0000.');
      await expect(
        inventory.adjustStock(world.manager, world.itemA, '0'),
      ).rejects.toThrow('An adjustment of zero changes nothing.');

      const movements = await inventory.movementsFor(world.itemA);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        delta: '-3.0000',
        reason: 'adjustment',
        balanceAfter: '7.0000',
        createdBy: { id: world.manager.id },
      });
    });

    it('should create, rename, re-map and delete categories', async () => {
      const travel = await categories.create({
        name: ' Travel ',
        expenseAccountId: world.accounts.misc,
      });
      expect(await categories.findById(travel.id)).toMatchObject({
        name: 'Travel',
        expenseAccount: { code: '6900' },
      });

      await categories.update(travel.id, {
        name: 'Trips',
        expenseAccountId: undefined,
      } as never);
      expect(await categories.findAll()).toMatchObject([
        { name: 'Trips', expenseAccount: null },
      ]);

      await categories.remove(travel.id);
      await expect(categories.findById(travel.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('StockRequestsService', () => {
    let stock: StockRequestsService;
    beforeEach(() => (stock = app.get(StockRequestsService)));

    it('should create, approve and reject requests', async () => {
      const request = await stock.create(world.employee, {
        inventoryItemId: world.itemA,
        qty: 2,
        priority: StockPriorityEnum.high,
      });
      expect(request).toMatchObject({
        qty: '2.0000',
        status: 'pending',
        priority: 'high',
      });

      await stock.approve(world.manager, request.id);
      await expect(stock.approve(world.manager, request.id)).rejects.toThrow(
        'This request is already approved.',
      );

      const detail = await stock.findOneForActor(world.employee, request.id);
      expect(detail).toMatchObject({
        status: 'approved',
        approvedBy: { firstName: 'manager' },
        fulfilledBy: null,
        inventoryItem: { sku: 'SKU-A', stockQty: '10.0000' },
        requester: { id: world.employee.id },
      });
      expect(detail.approvedAt).not.toBeNull();

      await stock.reject(world.manager, request.id);
      expect(
        (await stock.findOneForActor(world.manager, request.id)).status,
      ).toBe('rejected');
    });

    it('should not reject a fulfilled request', async () => {
      const id = await seedStockRequest(db, world.employee, world.itemA, '1');
      await stock.fulfil(world.manager, id);

      await expect(stock.reject(world.manager, id)).rejects.toThrow(
        'A fulfilled request cannot be rejected.',
      );
      expect(
        (await stock.findOneForActor(world.manager, id)).fulfilledBy?.id,
      ).toBe(world.manager.id);
    });

    it('should scope and filter the list', async () => {
      await seedStockRequest(db, world.employee, world.itemA, '1', 'pending');
      await seedStockRequest(db, world.manager, world.itemB, '1', 'approved');

      const own = await stock.list(world.employee, page);
      expect(own.count).toBe(1);
      expect(own.rows[0]).toMatchObject({
        inventoryItem: { sku: 'SKU-A' },
        requester: { firstName: 'employee' },
      });

      expect((await stock.list(world.manager, page)).count).toBe(2);
      expect(
        (
          await stock.list(world.manager, {
            ...page,
            status: 'approved' as never,
          })
        ).rows[0].inventoryItem.sku,
      ).toBe('SKU-B');
      await expect(
        stock.findOneForActor(
          world.employee,
          (await stock.list(world.manager, page)).rows[0].id,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
