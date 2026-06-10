import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  UserRole,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { NotificationChannelFactory } from './channels/channel.factory.js';
import { renderTemplate } from './templates/template-registry.js';
import type {
  SupportedLang,
  TemplateKey,
  TemplateVarsByKey,
} from './types/notification-templates.types.js';
import type { FindNotificationsDto } from './dto/find-notifications.dto.js';

/**
 * Input the registration / participants flow hands to NotificationsService
 * AFTER its transaction commits. Notifications must never block (or roll
 * back) the registration itself, so we deliberately receive plain data —
 * no Prisma TransactionClient.
 */
export interface RegistrationOutcomeInput {
  tenantId: string;
  participantId: string;
  enrolmentId?: string | null;
  outcome: 'ENROLLED' | 'WAITLISTED' | 'INQUIRY';
  /** Position on the waitlist; required when outcome === 'WAITLISTED'. */
  waitlistPosition?: number;
  participantName: string;
  participantLang: string;
  uniqueId: string;
  sessionName: string | null;
  locationId: string;
  locationName: string;
  guardian: {
    fullName: string;
    phone: string;
    email: string | null;
  };
}

/**
 * Input for `enqueueWaitlistOffer`. Built by WaitlistService.sendOffer
 * after it has rotated the offer token and committed the row update.
 */
export interface WaitlistOfferInput {
  tenantId: string;
  waitlistId: string;
  participantId: string;
  participantName: string;
  participantLang: string;
  sessionName: string;
  locationName: string;
  /** Absolute deadline by which the guardian must accept/decline. */
  expiresAt: Date;
  /** Short-lived token uniquely identifying this offer round. */
  offerToken: string;
  acceptUrl: string;
  declineUrl: string;
  guardian: {
    fullName: string;
    phone: string;
    email: string | null;
  };
}

interface CreateNotificationRow {
  tenantId: string;
  type: NotificationType;
  channel: NotificationChannel;
  participantId?: string | null;
  enrolmentId?: string | null;
  recipientUserId?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  bodyText: string;
  dedupeKey?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: NotificationChannelFactory,
  ) {}

  // ─── Public entry points ─────────────────────────────────────────────

  /**
   * Fires the participant/guardian confirmation + staff alert(s) for a
   * fresh registration. Idempotent per (participantId, outcome) — calling
   * this twice for the same registration is a no-op for the second call.
   *
   * Failures (channel errors, dispatch crashes) are caught and logged;
   * this method NEVER throws so callers (registration flow) can treat it
   * as fire-and-forget.
   */
  async enqueueRegistrationOutcome(input: RegistrationOutcomeInput): Promise<void> {
    try {
      // 1. Confirmation to the guardian (WhatsApp preferred, Email fallback).
      await this.enqueueGuardianConfirmation(input);

      // 2. Staff alert(s) — one per relevant admin.
      await this.enqueueStaffAlerts(input);
    } catch (err) {
      // Belt + suspenders. We already swallow per-notification failures
      // inside the helpers; this catch is for *programmer* errors (e.g.,
      // template var mismatch) that escape the per-row try/catch.
      this.logger.error(
        `[enqueueRegistrationOutcome] unexpected error for participant=${input.participantId}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * Plan D — send a "seat available, please accept/decline" message to
   * the guardian of a waitlisted participant. Fire-and-forget; caller
   * (WaitlistService.sendOffer) does not await the outcome.
   *
   * Idempotency: keyed on (waitlistId, offerToken). A given offerToken
   * is generated exactly once per offer round, so re-sending the same
   * notification — e.g., because the cron raced with a manual send — is
   * a no-op via the partial unique index on `dedupe_key`.
   */
  async enqueueWaitlistOffer(input: WaitlistOfferInput): Promise<void> {
    try {
      const lang: SupportedLang =
        input.participantLang === 'ar' ? 'ar' : 'en';

      const body = renderTemplate('WAITLIST_OFFER', lang, {
        guardianName: input.guardian.fullName,
        participantName: input.participantName,
        sessionName: input.sessionName,
        locationName: input.locationName,
        expiresAt: input.expiresAt.toISOString(),
        acceptUrl: input.acceptUrl,
        declineUrl: input.declineUrl,
      });

      const channel = input.guardian.phone
        ? NotificationChannel.WHATSAPP
        : NotificationChannel.EMAIL;

      await this.enqueueAndDispatch({
        tenantId: input.tenantId,
        type: NotificationType.WAITLIST_OFFER,
        channel,
        participantId: input.participantId,
        recipientPhone: input.guardian.phone,
        recipientEmail: input.guardian.email,
        bodyText: body,
        // Dedupe per offer round — same token = same logical offer.
        dedupeKey: `waitlist-offer:${input.waitlistId}:${input.offerToken}`,
      });
    } catch (err) {
      this.logger.error(
        `[enqueueWaitlistOffer] unexpected error for waitlist=${input.waitlistId}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  // ─── Admin / ops endpoints (back NotificationsController) ────────────

  async findAll(tenantId: string, user: { role: UserRole; locationId?: string | null; id: string }, query: FindNotificationsDto) {
    const { status, type, channel, participantId, recipientUserId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(type && { type }),
      ...(channel && { channel }),
      ...(participantId && { participantId }),
      ...(recipientUserId && { recipientUserId }),
    };

    // LOCATION_MANAGER can only see staff-alerts targeted at THEM, plus
    // participant-side notifications for participants in their location.
    // SUPER_ADMIN sees the full tenant view.
    if (user.role === UserRole.LOCATION_MANAGER && user.locationId) {
      where.OR = [
        { recipientUserId: user.id },
        { participant: { locationId: user.locationId } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: this.publicSelect(),
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, tenantId },
      select: this.publicSelect(),
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  /**
   * Manually re-dispatch a FAILED notification. Used by admins from the
   * dashboard when a transient provider issue is resolved.
   */
  async retry(tenantId: string, id: string) {
    const notif = await this.prisma.notification.findFirst({
      where: { id, tenantId },
    });
    if (!notif) {
      throw new NotFoundException('Notification not found');
    }
    if (notif.status === NotificationStatus.SENT || notif.status === NotificationStatus.DELIVERED) {
      // Re-sending a successfully-sent message would double-message the
      // recipient — reject loudly rather than silently succeed.
      throw new NotFoundException('Notification already sent — cannot retry');
    }

    await this.dispatch(notif.id);
    return this.findOne(tenantId, id);
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  /**
   * Creates a notification row and immediately attempts dispatch.
   * Returns the notification id (or null if a dedupe-key collision
   * meant we skipped the write).
   *
   * Never throws — all errors are recorded on the row.
   */
  private async enqueueAndDispatch(
    input: CreateNotificationRow,
  ): Promise<string | null> {
    // Idempotency: if a row with this (tenantId, dedupeKey) already
    // exists, skip — same logical notification was already enqueued.
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findFirst({
        where: { tenantId: input.tenantId, dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.debug(
          `[enqueueAndDispatch] dedupe hit for tenant=${input.tenantId} key=${input.dedupeKey} — skipping`,
        );
        return null;
      }
    }

    let notificationId: string;
    try {
      const row = await this.prisma.notification.create({
        data: {
          tenantId: input.tenantId,
          type: input.type,
          channel: input.channel,
          status: NotificationStatus.QUEUED,
          participantId: input.participantId ?? null,
          enrolmentId: input.enrolmentId ?? null,
          recipientUserId: input.recipientUserId ?? null,
          recipientPhone: input.recipientPhone ?? null,
          recipientEmail: input.recipientEmail ?? null,
          bodyText: input.bodyText,
          dedupeKey: input.dedupeKey ?? null,
        },
        select: { id: true },
      });
      notificationId = row.id;
    } catch (err) {
      // Race: dedupe key inserted between our check and our insert.
      // The partial unique index throws P2002 — treat as success-no-op.
      const code = (err as { code?: string })?.code;
      if (code === 'P2002' && input.dedupeKey) {
        this.logger.debug(
          `[enqueueAndDispatch] P2002 race on dedupe key=${input.dedupeKey} — treating as duplicate, no-op`,
        );
        return null;
      }
      this.logger.error(
        `[enqueueAndDispatch] failed to insert notification row: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      return null;
    }

    await this.dispatch(notificationId);
    return notificationId;
  }

  /**
   * Sends a previously-queued notification via the matching channel impl.
   * Updates the row to SENT/FAILED with externalId or failureReason.
   * Never throws — failures are recorded on the row.
   */
  private async dispatch(notificationId: string): Promise<void> {
    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notif) {
      this.logger.error(`[dispatch] notification ${notificationId} not found`);
      return;
    }

    const recipient =
      notif.channel === NotificationChannel.WHATSAPP
        ? notif.recipientPhone
        : notif.recipientEmail;

    if (!recipient) {
      await this.markFailure(
        notif.id,
        `No recipient available for channel=${notif.channel}`,
      );
      return;
    }

    if (!notif.bodyText) {
      await this.markFailure(notif.id, 'No body_text on notification');
      return;
    }

    const channelImpl = this.channels.get(notif.channel);
    let result;
    try {
      result = await channelImpl.send({
        recipient,
        body: notif.bodyText,
        tenantId: notif.tenantId,
        notificationId: notif.id,
      });
    } catch (err) {
      // Channel impls are supposed to return {success: false} instead of
      // throwing — but defensively handle escapes.
      await this.markFailure(
        notif.id,
        `Channel threw: ${(err as Error)?.message ?? 'unknown'}`,
      );
      return;
    }

    if (!result.success) {
      await this.markFailure(notif.id, result.failureReason ?? 'Channel returned success=false with no reason');
      return;
    }

    await this.prisma.notification.update({
      where: { id: notif.id },
      data: {
        status: NotificationStatus.SENT,
        externalId: result.externalId,
        sentAt: new Date(),
        failureReason: null,
      },
    });
  }

  private async markFailure(id: string, reason: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationStatus.FAILED,
        failureReason: reason,
        retryCount: { increment: 1 },
      },
    });
    this.logger.warn(`[dispatch] notification ${id} FAILED: ${reason}`);
  }

  // ─── Domain-specific enqueue helpers ─────────────────────────────────

  private async enqueueGuardianConfirmation(
    input: RegistrationOutcomeInput,
  ): Promise<void> {
    // Map outcome → template key. ENROLLED and WAITLISTED need a sessionName;
    // INQUIRY does not (no session was chosen).
    const lang: SupportedLang = input.participantLang === 'ar' ? 'ar' : 'en';

    let templateKey: TemplateKey;
    let vars: TemplateVarsByKey[TemplateKey];

    if (input.outcome === 'ENROLLED') {
      if (!input.sessionName) {
        // Programmer error — ENROLLED must have a session. Bail loudly.
        this.logger.error(
          `[enqueueGuardianConfirmation] outcome=ENROLLED but no sessionName for participant=${input.participantId}`,
        );
        return;
      }
      templateKey = 'REGISTRATION_ENROLLED';
      vars = {
        guardianName: input.guardian.fullName,
        participantName: input.participantName,
        sessionName: input.sessionName,
        locationName: input.locationName,
        uniqueId: input.uniqueId,
      } satisfies TemplateVarsByKey['REGISTRATION_ENROLLED'];
    } else if (input.outcome === 'WAITLISTED') {
      if (!input.sessionName || input.waitlistPosition === undefined) {
        this.logger.error(
          `[enqueueGuardianConfirmation] outcome=WAITLISTED missing sessionName/position for participant=${input.participantId}`,
        );
        return;
      }
      templateKey = 'REGISTRATION_WAITLISTED';
      vars = {
        guardianName: input.guardian.fullName,
        participantName: input.participantName,
        sessionName: input.sessionName,
        locationName: input.locationName,
        uniqueId: input.uniqueId,
        position: input.waitlistPosition,
      } satisfies TemplateVarsByKey['REGISTRATION_WAITLISTED'];
    } else {
      templateKey = 'REGISTRATION_INQUIRY';
      vars = {
        guardianName: input.guardian.fullName,
        participantName: input.participantName,
        locationName: input.locationName,
        uniqueId: input.uniqueId,
      } satisfies TemplateVarsByKey['REGISTRATION_INQUIRY'];
    }

    const body = renderTemplate(
      templateKey,
      lang,
      // Cast is safe — templateKey and vars were chosen together above.
      vars as never,
    );

    // Choose channel: prefer WhatsApp if we have a phone; fall back to Email.
    // Today the guardian always has a phone (schema requires it) so WhatsApp
    // is effectively the default until we add per-tenant channel prefs.
    const channel = input.guardian.phone
      ? NotificationChannel.WHATSAPP
      : NotificationChannel.EMAIL;

    await this.enqueueAndDispatch({
      tenantId: input.tenantId,
      type: NotificationType.REGISTRATION_CONFIRM,
      channel,
      participantId: input.participantId,
      enrolmentId: input.enrolmentId ?? null,
      recipientPhone: input.guardian.phone,
      recipientEmail: input.guardian.email,
      bodyText: body,
      // Dedupe per (participant, REGISTRATION_CONFIRM) — a second
      // registration submission for the same participant shouldn't
      // re-notify the guardian.
      dedupeKey: `registration:${input.participantId}:guardian-confirm`,
    });
  }

  private async enqueueStaffAlerts(
    input: RegistrationOutcomeInput,
  ): Promise<void> {
    // Resolve recipients: all SUPER_ADMINs for the tenant + LOCATION_MANAGERs
    // for THIS location. STAFF and FINANCE_OFFICER are skipped — they get
    // info via the dashboard, not push notifications.
    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        OR: [
          { role: UserRole.SUPER_ADMIN },
          { role: UserRole.LOCATION_MANAGER, locationId: input.locationId },
        ],
      },
      select: { id: true, email: true },
    });

    if (recipients.length === 0) {
      this.logger.warn(
        `[enqueueStaffAlerts] no admin users found for tenant=${input.tenantId} location=${input.locationId}`,
      );
      return;
    }

    const body = renderTemplate('STAFF_ALERT_NEW_INQUIRY', 'en', {
      participantName: input.participantName,
      uniqueId: input.uniqueId,
      locationName: input.locationName,
      guardianName: input.guardian.fullName,
      guardianPhone: input.guardian.phone,
      outcome: input.outcome,
    });

    // Fire all admin alerts. We await sequentially (rather than Promise.all)
    // so a failure in one doesn't abort the rest — but each enqueueAndDispatch
    // already catches its own errors, so Promise.all would also be safe.
    // Sequential keeps the log output ordered for ops readability.
    for (const recipient of recipients) {
      await this.enqueueAndDispatch({
        tenantId: input.tenantId,
        type: NotificationType.STAFF_ALERT,
        channel: NotificationChannel.EMAIL,
        participantId: input.participantId,
        enrolmentId: input.enrolmentId ?? null,
        recipientUserId: recipient.id,
        recipientEmail: recipient.email,
        bodyText: body,
        // Dedupe per (participant, recipient) — one alert per admin per
        // participant registration, no matter how many times the request
        // is retried.
        dedupeKey: `registration:${input.participantId}:staff-alert:${recipient.id}`,
      });
    }
  }

  /**
   * Single source of truth for which Notification columns are safe to
   * return through the API. Excludes nothing today (no secrets on the
   * row) but centralizing it means future PII fields can be hidden
   * in one place.
   */
  private publicSelect() {
    return {
      id: true,
      tenantId: true,
      participantId: true,
      enrolmentId: true,
      recipientUserId: true,
      recipientPhone: true,
      recipientEmail: true,
      channel: true,
      type: true,
      status: true,
      bodyText: true,
      dedupeKey: true,
      externalId: true,
      failureReason: true,
      retryCount: true,
      sentAt: true,
      createdAt: true,
    } satisfies Prisma.NotificationSelect;
  }
}
