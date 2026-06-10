import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationChannelFactory } from './channels/channel.factory.js';
import { StubEmailChannel } from './channels/stub-email.channel.js';
import { StubWhatsAppChannel } from './channels/stub-whatsapp.channel.js';

/**
 * Notifications module.
 *
 * Exposes:
 *   * `NotificationsService` — injected by RegistrationService /
 *     ParticipantsService to fire confirmation + staff-alert notifications
 *     AFTER their transactions commit.
 *   * `GET /notifications`, `GET /notifications/:id`, `POST /notifications/:id/retry`
 *     for admin dashboards.
 *
 * Channel implementations are currently stubs (log + mark sent) until
 * the client provides WhatsApp / Email credentials. Swapping a stub for
 * a real provider is a one-line change in NotificationChannelFactory's
 * constructor injection — no caller code touched.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationChannelFactory,
    StubWhatsAppChannel,
    StubEmailChannel,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
