import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { InlineKeyboard } from 'grammy';
import { NotificationEntity } from './entities/notification.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { TelegramService } from '../telegram/telegram.service';
import { RoleEnum } from '../roles/roles.enum';
import { AllConfigType } from '../config/config.type';

export type NotificationEvent =
  | 'pr_created'
  | 'pr_decided'
  | 'pr_approved'
  | 'po_created'
  | 'payment_recorded'
  | 'claim_submitted'
  | 'claim_confirmed'
  | 'stock_request_submitted'
  | 'stock_below_reorder'
  | 'exchange_rate_updated';

export type NotifyPayload = Record<string, unknown> & {
  /** Users who should receive this as a direct message and an in-app row. */
  recipientIds?: number[];
};

type Route = {
  /**
   * Every route is a direct message to whichever users it resolves to — there is no
   * group-chat delivery. `manager`/`finance` mean "every active user holding that role
   * (admin included) who has linked their Telegram account"; `recipients` means the
   * specific `recipientIds` the caller passed in payload.
   */
  target: 'manager' | 'finance' | 'recipients';
  title: string;
};

/**
 * The single `notify(event, payload)` abstraction (Part 1 §2.8, adapted). Business logic
 * calls this and nothing else — it never touches the Bot API directly.
 *
 * Every notification writes an in-app `notifications` row for its recipients, whether or
 * not Telegram is configured, whether or not that recipient has linked Telegram, and
 * whether or not the send succeeds. Nothing here throws. Telegram delivery is always a
 * direct message to the recipient's own linked account, resolved by role — there is no
 * shared group chat or forum topic to configure.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Routing by role, not by group chat — see the Route type above. */
  private readonly routes: Record<NotificationEvent, Route> = {
    pr_created: { target: 'manager', title: 'Purchase request raised' },
    claim_submitted: { target: 'manager', title: 'Goods claimed' },
    stock_request_submitted: { target: 'manager', title: 'Stock requested' },
    po_created: { target: 'finance', title: 'Purchase order created' },
    payment_recorded: { target: 'manager', title: 'Payment recorded' },
    pr_decided: { target: 'recipients', title: 'Purchase request decided' },
    pr_approved: {
      target: 'finance',
      title: 'Purchase request ready for a PO',
    },
    claim_confirmed: { target: 'recipients', title: 'Claim confirmed' },
    stock_below_reorder: {
      target: 'manager',
      title: 'Stock below reorder point',
    },
    exchange_rate_updated: {
      target: 'finance',
      title: 'Exchange rate updated',
    },
  };

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repository: Repository<NotificationEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly telegram: TelegramService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  private async usersInRoles(roles: RoleEnum[]): Promise<UserEntity[]> {
    return this.users.find({
      where: { active: true, role: { id: In(roles) } },
    });
  }

  private async usersByIds(ids: number[]): Promise<UserEntity[]> {
    if (!ids.length) return [];
    return this.users.find({ where: { id: In(ids), active: true } });
  }

  private async resolveRecipients(
    route: Route,
    recipientIds: number[],
  ): Promise<UserEntity[]> {
    switch (route.target) {
      case 'manager':
        return this.usersInRoles([RoleEnum.manager, RoleEnum.admin]);
      case 'finance':
        return this.usersInRoles([RoleEnum.finance, RoleEnum.admin]);
      case 'recipients':
      default:
        return this.usersByIds(recipientIds);
    }
  }

  /**
   * Fire-and-forget. Callers do not await the Telegram side of this — a slow Bot API must
   * not slow down a form post.
   */
  async notify(
    event: NotificationEvent,
    payload: NotifyPayload,
  ): Promise<void> {
    try {
      const route = this.routes[event];
      if (!route) return;

      const { recipientIds = [], ...detail } = payload;
      const text = this.render(event, route.title, detail);

      const recipients = await this.resolveRecipients(route, recipientIds);

      // In-app rows first: they are the durable record, Telegram is the courier. Written
      // for every recipient regardless of whether they have linked Telegram.
      if (recipients.length) {
        await this.repository.save(
          recipients.map((user) =>
            this.repository.create({
              user: { id: user.id } as never,
              event,
              payload: detail,
            }),
          ),
        );
      }

      if (!this.telegram.isConfigured) return;

      const keyboard = this.linkFor(event, detail);

      for (const user of recipients) {
        if (!user.telegramId) continue;

        const messageId = await this.telegram.send({
          chatId: user.telegramId,
          text,
          keyboard,
        });

        if (messageId) await this.markSent([user.id], event);
      }
    } catch (error) {
      // Notification failures never surface to the caller.
      this.logger.error(`notify(${event}) failed: ${(error as Error).message}`);
    }
  }

  private async markSent(
    userIds: number[],
    event: NotificationEvent,
  ): Promise<void> {
    if (!userIds.length) return;

    await this.repository
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ telegramSent: true })
      .where('user_id IN (:...userIds)', { userIds })
      .andWhere('event = :event', { event })
      .andWhere('telegram_sent = false')
      .execute();
  }

  /**
   * Two buttons to the live record, instead of inline approve/reject buttons.
   *
   * Deliberately not stateful: this used to send tappable Approve/Reject buttons with
   * callback data, but a decision made anywhere other than that exact tap (the website, or
   * a different recipient's copy of the same message) had no way to go back and update
   * them — reported live as "I approve on the website but Telegram doesn't update." A link
   * has no state to go stale: it always opens the real record, which always shows whatever
   * is true right now. Whoever opens it still goes through the same permission checks the
   * destination screen already has — this is a shortcut to the form, not a bypass of it.
   *
   * "Review in app" is a `web_app` button that opens *inside* Telegram, deep-linked via a
   * query string to the Mini App's matching review screen (see public/js/miniapp.js's
   * `?screen=`/`?id=` handling). "Review on web" is a plain link to the same record on the
   * website, for anyone who'd rather use a full browser. Only shown when
   * `TELEGRAM_MINIAPP_URL` is set — `web_app` buttons require HTTPS and Telegram rejects
   * the type outright without one, so without it the message carries the web link alone.
   */
  private linkFor(
    event: NotificationEvent,
    detail: Record<string, unknown>,
  ): InlineKeyboard | undefined {
    const base = this.configService.get('app.backendDomain', { infer: true });
    const miniAppUrl = this.telegram.miniAppUrl;

    const buttons = (screen: string, id: unknown, webPath: string) => {
      const keyboard = new InlineKeyboard();

      if (miniAppUrl) {
        const url = new URL(miniAppUrl);
        url.searchParams.set('screen', screen);
        url.searchParams.set('id', String(id));
        keyboard.webApp('📱 Review in app', url.toString());
      }

      keyboard.url('🌐 Review on web', `${base}${webPath}`);

      return keyboard;
    };

    if (event === 'pr_created' && detail.purchaseRequestId) {
      return buttons(
        'pr',
        detail.purchaseRequestId,
        `/purchase-requests/${detail.purchaseRequestId}`,
      );
    }

    if (event === 'pr_approved' && detail.purchaseRequestId) {
      return buttons(
        'pr',
        detail.purchaseRequestId,
        `/purchase-requests/${detail.purchaseRequestId}`,
      );
    }

    if (event === 'claim_submitted' && detail.claimId) {
      return buttons('claim', detail.claimId, `/claims`);
    }

    if (event === 'stock_request_submitted' && detail.stockRequestId) {
      return buttons(
        'stock',
        detail.stockRequestId,
        `/stock-requests/${detail.stockRequestId}`,
      );
    }

    return undefined;
  }

  /** One recognisable icon per event, so the notification list / lock-screen preview reads
   *  at a glance without opening the message. Decision-outcome events override this with
   *  ✅/❌ in `render()`, since "did it go through" is the one thing worth seeing first. */
  private readonly icons: Record<NotificationEvent, string> = {
    pr_created: '🧾',
    pr_decided: '✅',
    pr_approved: '🧾',
    po_created: '📦',
    payment_recorded: '💸',
    claim_submitted: '📬',
    claim_confirmed: '✅',
    stock_request_submitted: '📤',
    stock_below_reorder: '⚠️',
    exchange_rate_updated: '💱',
  };

  /** HTML is Telegram's `parse_mode` here, so any user-supplied text (a PR note, an item
   *  name, ...) must be escaped before going in — unescaped, a stray `<` either breaks the
   *  send outright ("can't parse entities") or, worse, lets free-text fields inject real
   *  formatting or a tappable link into what's supposed to be a trustworthy notification. */
  private esc(value: unknown): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private render(
    event: NotificationEvent,
    title: string,
    detail: Record<string, unknown>,
  ): string {
    let icon = this.icons[event] ?? '🔔';
    let heading = title;

    // The one thing worth seeing before anything else: did it go through or not.
    if (event === 'pr_decided') {
      const rejected = String(detail.decision).toLowerCase() === 'rejected';
      icon = rejected ? '❌' : '✅';
      heading = `Purchase request ${rejected ? 'rejected' : 'approved'}`;
    }

    const lines = [`${icon} <b>${this.esc(heading)}</b>`, ''];

    // The record's own number/id, set apart in monospace, right under the heading — the
    // thing you'd look for first to recognise which record this is about.
    if (detail.number) {
      lines.push(`🔖 <code>${this.esc(detail.number)}</code>`, '');
    }

    const field = (icon: string, label: string, value: unknown) => {
      if (value === undefined || value === null || value === '') return;
      lines.push(`${icon} <b>${label}:</b> ${this.esc(value)}`);
    };

    // Multi-line, unlike the other fields: the label sits on its own line so each item
    // reads as a bullet under it rather than trailing awkwardly off "Items:".
    if (detail.items) {
      lines.push('🧺 <b>Items:</b>');
      for (const line of String(detail.items).split('\n')) {
        lines.push(`  • ${this.esc(line)}`);
      }
    }

    field('📦', 'Item', detail.item);
    field('💵', 'Amount', detail.amount);
    field('🔢', 'Quantity', detail.quantity);
    field('👤', 'Requester', detail.requester);
    field('🏬', 'Department', detail.department);
    field('📁', 'Project', detail.project);
    field('🏢', 'Supplier', detail.supplier);
    field('✍️', 'By', detail.actor);
    field('📝', 'Note', detail.note);

    if (event === 'stock_below_reorder') {
      field('🏷️', 'SKU', detail.sku);
      field('📊', 'On hand', detail.balance_after ?? detail.balanceAfter);
      field('📉', 'Reorder point', detail.reorder_point ?? detail.reorderPoint);
    }

    return lines.join('\n');
  }

  /** The in-app panel; the dashboard reads unread rows for the signed-in user. */
  async markAllRead(userId: number): Promise<void> {
    await this.repository.update(
      { user: { id: userId }, read: false },
      { read: true },
    );
  }
}
