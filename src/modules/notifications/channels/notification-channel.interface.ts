import type { NotificationChannel } from '@prisma/client';

/**
 * Output of a channel's send attempt. Notification dispatch in this codebase
 * is fire-and-forget from the caller's perspective; failures are NEVER thrown
 * back through `NotificationsService.dispatch` — instead the channel returns
 * a `success: false` result, which the service persists as status=FAILED
 * with the failureReason recorded so an operator/cron can retry later.
 */
export interface DispatchResult {
  success: boolean;
  /**
   * Provider-side identifier (e.g. WhatsApp message id, SES Message-ID).
   * `null` when the channel is a stub or the provider doesn't return one.
   */
  externalId: string | null;
  /**
   * Reason for failure. Required when `success === false`, otherwise null.
   * Surfaces directly into Notification.failureReason for support visibility.
   */
  failureReason: string | null;
}

/**
 * Payload handed to a channel's `send`. Contains everything pre-rendered
 * so channels are I/O-only and never touch templates or DB.
 */
export interface ChannelSendPayload {
  /** E.164 phone (WhatsApp/SMS) or email address (EMAIL). Channel-specific. */
  recipient: string;
  /** Fully rendered, ready-to-send body. Already localized. */
  body: string;
  /** Tenant id — included for provider-side multi-tenant routing/auditing. */
  tenantId: string;
  /** Notification id — included so providers can correlate webhooks back. */
  notificationId: string;
}

/**
 * All channel adapters implement this contract. The factory
 * (`channel.factory.ts`) returns the right impl for a given
 * `NotificationChannel` enum value, and swapping a stub for a real
 * implementation later requires no caller changes.
 */
export interface INotificationChannel {
  readonly channel: NotificationChannel;
  send(payload: ChannelSendPayload): Promise<DispatchResult>;
}
