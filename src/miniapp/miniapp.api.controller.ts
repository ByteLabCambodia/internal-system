import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { MiniAppAuthGuard } from './miniapp-auth.guard';
import { MiniAppLinkDto } from './dto/miniapp-link.dto';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import { PurchaseRequestsService } from '../procurement/purchase-requests.service';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { ClaimsService } from '../inventory/claims.service';
import { InventoryService } from '../inventory/inventory.service';
import { StockRequestsService } from '../stock/stock-requests.service';
import { RatesService } from '../accounting/rates.service';
import { OrgService } from '../org/org.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrStatusEnum } from '../common/enums';
import { summarizeItems } from '../procurement/support/notification-summary';
import { PermissionEnum } from '../permissions/permissions.enum';
import { CreatePurchaseRequestDto } from '../procurement/dto/create-purchase-request.dto';
import { CreateClaimDto } from '../inventory/dto/create-claim.dto';
import { CreateStockRequestDto } from '../stock/dto/create-stock-request.dto';
import { User } from '../users/domain/user';

/**
 * The Mini App's JSON surface. Same services, same guards' worth of checks — the only
 * difference from the browser is how the caller is authenticated (initData HMAC).
 *
 * This sits under the API prefix, so these are /api/v1/miniapp/*.
 */
@UseGuards(MiniAppAuthGuard)
@Controller({ path: 'miniapp', version: '1' })
export class MiniAppApiController {
  constructor(
    private readonly links: TelegramLinkService,
    private readonly purchaseRequests: PurchaseRequestsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly claims: ClaimsService,
    private readonly inventory: InventoryService,
    private readonly stockRequests: StockRequestsService,
    private readonly rates: RatesService,
    private readonly org: OrgService,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  private actor(request: Request): User {
    const user = request['user'] as User | undefined;

    if (!user) {
      throw new UnauthorizedException(
        'This Telegram account is not linked to a profile yet.',
      );
    }

    return user;
  }

  /**
   * Manual permission check, not `@RequirePermission` + the global `PermissionsGuard`.
   * That guard runs before this controller's own `MiniAppAuthGuard` (global guards execute
   * ahead of controller-scoped ones), so `request.user` would not be populated yet — the
   * check would always see an anonymous actor and always refuse. Checking here, after
   * `this.actor(request)` has resolved the real user, avoids that ordering trap entirely.
   */
  private requirePermission(actor: User, permission: PermissionEnum): void {
    if (!this.permissions.can(actor, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  /** Link screen: credentials → telegram_id, for a webview that has no session. */
  @Post('link')
  async link(@Req() request: Request, @Body() dto: MiniAppLinkDto) {
    const telegram = request['telegramUser'] as {
      telegramId: string;
      username?: string;
    };

    await this.links.linkWithCredentials(
      dto.email,
      dto.password,
      telegram.telegramId,
      telegram.username,
    );

    return { ok: true };
  }

  /** Everything the three forms need in one round trip. */
  @Post('data')
  async data(@Req() request: Request) {
    const user = request['user'] as User | undefined;

    if (!user) {
      return { linked: false };
    }

    const [items, orders, departments, rates] = await Promise.all([
      this.inventory.findActive(),
      this.claims.claimableLines(),
      this.org.findActiveDepartments(),
      this.rates.currentRates(),
    ]);

    return {
      linked: true,
      profile: {
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        email: user.email,
        department: user.department,
      },
      items: items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        stockQty: item.stockQty,
      })),
      poLines: orders.map((line) => ({
        id: line.id,
        name: line.name,
        poNumber: line.purchaseOrder?.poNumber,
        outstanding: Number(line.qtyOrdered) - Number(line.qtyClaimed),
        inventoryItemId: line.inventoryItem?.id ?? null,
      })),
      departments: departments.map((department) => department.name),
      rates,
    };
  }

  @Post('pr')
  async createPurchaseRequest(
    @Req() request: Request,
    @Body() dto: CreatePurchaseRequestDto,
  ) {
    const actor = this.actor(request);
    const pr = await this.purchaseRequests.create(actor, dto, true);

    await this.notifications.notify('pr_created', {
      purchaseRequestId: pr.id,
      number: pr.prNumber,
      requester: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
      amount: `${pr.totalOriginal} ${pr.currency}`,
      items: summarizeItems(pr.items),
      department: pr.department?.name,
      project: pr.project?.name,
      note: pr.note,
    });

    return { ok: true, id: pr.id, number: pr.prNumber };
  }

  @Post('stock')
  async createStockRequest(
    @Req() request: Request,
    @Body() dto: CreateStockRequestDto,
  ) {
    const actor = this.actor(request);
    const stockRequest = await this.stockRequests.create(actor, dto);

    await this.notifications.notify('stock_request_submitted', {
      stockRequestId: stockRequest.id,
      quantity: stockRequest.qty,
      requester: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
    });

    return { ok: true, id: stockRequest.id };
  }

  @Post('claim')
  async createClaim(@Req() request: Request, @Body() dto: CreateClaimDto) {
    const actor = this.actor(request);
    const claim = await this.claims.create(actor, dto);

    await this.notifications.notify('claim_submitted', {
      claimId: claim.id,
      quantity: claim.qtyClaimed,
      requester: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
    });

    return { ok: true, id: claim.id };
  }

  /** History browser: the actor's own records, scoped by the same services. */
  @Post('history')
  async history(@Req() request: Request) {
    const actor = this.actor(request);

    const [prs, claims, stock] = await Promise.all([
      this.purchaseRequests.list(actor, { page: 1, limit: 20 }),
      this.claims.list(actor, { page: 1, limit: 20 }),
      this.stockRequests.list(actor, { page: 1, limit: 20 }),
    ]);

    return {
      purchaseRequests: prs.rows.map((row) => ({
        id: row.id,
        number: row.prNumber,
        status: row.status,
        total: `${row.totalOriginal} ${row.currency}`,
        createdAt: row.createdAt,
      })),
      claims: claims.rows.map((row) => ({
        id: row.id,
        item: row.inventoryItem?.name ?? '',
        qty: row.qtyClaimed,
        status: row.status,
        createdAt: row.createdAt,
      })),
      stockRequests: stock.rows.map((row) => ({
        id: row.id,
        item: row.inventoryItem?.name ?? '',
        qty: row.qty,
        status: row.status,
        createdAt: row.createdAt,
      })),
    };
  }

  @Post('history/pr/:id')
  async purchaseRequestDetail(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = this.actor(request);
    const pr = await this.purchaseRequests.findOneForActor(actor, id);

    return {
      id: pr.id,
      number: pr.prNumber,
      status: pr.status,
      currency: pr.currency,
      total: pr.totalOriginal,
      totalUsd: pr.totalUsd,
      note: pr.note,
      requester: [pr.requester.firstName, pr.requester.lastName]
        .filter(Boolean)
        .join(' '),
      items: pr.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        unitPrice: item.unitPriceOriginal,
      })),
      // Whether *this* screen should offer Approve/Reject — the endpoint below re-checks
      // everything anyway (permission, pending status, threshold, self-approval policy),
      // this only decides whether to show the buttons at all.
      canDecide:
        pr.status === 'pending' &&
        this.permissions.can(actor, PermissionEnum['pr.decide']),
    };
  }

  /**
   * Approve or reject, reusing the exact service the website's PR detail page calls —
   * including the `pr_decided` notification back to the requester, which this endpoint
   * originally forgot (caught testing the message format: the requester never heard the
   * outcome when a decision was made from the Mini App, only from the website).
   */
  @Post('history/pr/:id/decide')
  async decidePurchaseRequest(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: string,
  ) {
    const actor = this.actor(request);
    this.requirePermission(actor, PermissionEnum['pr.decide']);

    const pr = await this.purchaseRequests.decide(
      actor,
      id,
      decision === 'reject' ? 'rejected' : 'approved',
    );

    await this.notifications.notify('pr_decided', {
      recipientIds: [Number(pr.requester.id)],
      purchaseRequestId: pr.id,
      number: pr.prNumber,
      decision: pr.status,
      amount: `${pr.totalOriginal} ${pr.currency}`,
      items: summarizeItems(pr.items),
      actor: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
    });

    if (pr.status === PrStatusEnum.approved) {
      await this.notifications.notify('pr_approved', {
        purchaseRequestId: pr.id,
        number: pr.prNumber,
        amount: `${pr.totalOriginal} ${pr.currency}`,
        department: pr.department?.name,
        project: pr.project?.name,
        note: pr.note,
        requester: [pr.requester.firstName, pr.requester.lastName]
          .filter(Boolean)
          .join(' '),
      });
    }

    return { ok: true, status: pr.status };
  }

  @Post('history/claim/:id')
  async claimDetail(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = this.actor(request);
    const claim = await this.claims.findOneForActor(actor, id);

    return {
      id: claim.id,
      status: claim.status,
      qty: claim.qtyClaimed,
      item: claim.inventoryItem?.name ?? '',
      poNumber: claim.purchaseOrder?.poNumber ?? null,
      requester: [claim.claimedBy?.firstName, claim.claimedBy?.lastName]
        .filter(Boolean)
        .join(' '),
      canDecide:
        claim.status === 'pending' &&
        this.permissions.can(actor, PermissionEnum['claim.confirm']),
    };
  }

  /** Confirm or reject, including the `claim_confirmed` notification back to the claimant
   *  on confirm — mirrors the website's claims list action exactly (see decidePurchaseRequest
   *  for why this matters: it was missed here originally and the claimant never heard). */
  @Post('history/claim/:id/decide')
  async decideClaim(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: string,
  ) {
    const actor = this.actor(request);
    this.requirePermission(actor, PermissionEnum['claim.confirm']);

    // Fetched before deciding: confirm()/reject() return void, and this is what the
    // notification needs (item name, who claimed it).
    const claim = await this.claims.findOneForActor(actor, id);

    if (decision === 'reject') {
      await this.claims.reject(actor, id);
      return { ok: true, status: 'rejected' };
    }

    await this.claims.confirm(actor, id);

    await this.notifications.notify('claim_confirmed', {
      recipientIds: claim.claimedBy ? [Number(claim.claimedBy.id)] : [],
      claimId: id,
      item: claim.inventoryItem?.name,
      quantity: claim.qtyClaimed,
      actor: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
    });

    return { ok: true, status: 'confirmed' };
  }

  @Post('history/stock/:id')
  async stockRequestDetail(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = this.actor(request);
    const stockRequest = await this.stockRequests.findOneForActor(actor, id);

    return {
      id: stockRequest.id,
      status: stockRequest.status,
      qty: stockRequest.qty,
      priority: stockRequest.priority,
      item: stockRequest.inventoryItem?.name ?? '',
      note: stockRequest.note,
      requester: [
        stockRequest.requester?.firstName,
        stockRequest.requester?.lastName,
      ]
        .filter(Boolean)
        .join(' '),
      canDecide:
        stockRequest.status !== 'fulfilled' &&
        stockRequest.status !== 'rejected' &&
        this.permissions.can(actor, PermissionEnum['stock.fulfil']),
    };
  }

  @Post('history/stock/:id/decide')
  async decideStockRequest(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: string,
  ) {
    const actor = this.actor(request);
    this.requirePermission(actor, PermissionEnum['stock.fulfil']);

    if (decision === 'reject') {
      await this.stockRequests.reject(actor, id);
      return { ok: true, status: 'rejected' };
    }

    await this.stockRequests.fulfil(actor, id);
    return { ok: true, status: 'fulfilled' };
  }

  /** Unread in-app notifications for the linked profile. */
  @Post('notify')
  async notify(@Req() request: Request) {
    const actor = this.actor(request);
    await this.notifications.markAllRead(Number(actor.id));

    return { ok: true };
  }

  @Get('health')
  health() {
    return { ok: true };
  }
}
