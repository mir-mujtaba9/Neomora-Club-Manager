import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  ChannelSendPayload,
  DispatchResult,
  INotificationChannel,
} from './notification-channel.interface.js';

/**
 * Placeholder WhatsApp channel. Until the client provides Meta Cloud API
 * credentials, every WhatsApp-typed notification is "sent" by logging it
 * to the server console and returning a synthetic externalId.
 *
 * Swap-in plan for real WhatsApp:
 *   1. Add WHATSAPP_PHONE_ID + WHATSAPP_TOKEN to env (or pull from
 *      Tenant.whatsappPhoneId / whatsappToken if per-tenant).
 *   2. Replace this file's `send` body with a fetch to
 *      `https://graph.facebook.com/v18.0/${phoneId}/messages`.
 *   3. Keep the `INotificationChannel` contract identical — no caller
 *      changes needed.
 *   4. Map provider errors to DispatchResult.failureReason (never throw).
 */
@Injectable()
export class StubWhatsAppChannel implements INotificationChannel {
  readonly channel = NotificationChannel.WHATSAPP;
  private readonly logger = new Logger(StubWhatsAppChannel.name);

  async send(payload: ChannelSendPayload): Promise<DispatchResult> {
    // Validate at the boundary — stubs are still I/O surfaces.
    if (!payload.recipient || !payload.recipient.trim()) {
      return {
        success: false,
        externalId: null,
        failureReason: 'STUB_WHATSAPP: empty recipient phone',
      };
    }

    this.logger.log(
      `[STUB WHATSAPP → ${payload.recipient}] (tenant=${payload.tenantId}, notif=${payload.notificationId}) ${payload.body}`,
    );

    return {
      success: true,
      externalId: `stub-wa-${randomUUID()}`,
      failureReason: null,
    };
  }
}
