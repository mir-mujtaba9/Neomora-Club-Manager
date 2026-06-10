import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  ChannelSendPayload,
  DispatchResult,
  INotificationChannel,
} from './notification-channel.interface.js';

/**
 * Placeholder Email channel. Until SES (or equivalent) credentials arrive
 * from the client, every EMAIL-typed notification is "sent" by logging it
 * to the server console.
 *
 * Swap-in plan for real Email:
 *   1. Add AWS_SES creds + EMAIL_FROM env (or per-tenant Tenant.emailFrom).
 *   2. Replace `send` body with `SESClient.send(new SendEmailCommand(...))`.
 *   3. Keep the `INotificationChannel` contract identical.
 *   4. Subject line generation may need its own template — extend the
 *      registry then, not now (YAGNI).
 */
@Injectable()
export class StubEmailChannel implements INotificationChannel {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(StubEmailChannel.name);

  async send(payload: ChannelSendPayload): Promise<DispatchResult> {
    // Minimal RFC-822 sanity check — anything with an "@" passes for a stub.
    if (!payload.recipient || !payload.recipient.includes('@')) {
      return {
        success: false,
        externalId: null,
        failureReason: 'STUB_EMAIL: recipient is not a valid-looking email',
      };
    }

    this.logger.log(
      `[STUB EMAIL → ${payload.recipient}] (tenant=${payload.tenantId}, notif=${payload.notificationId}) ${payload.body}`,
    );

    return {
      success: true,
      externalId: `stub-em-${randomUUID()}`,
      failureReason: null,
    };
  }
}
