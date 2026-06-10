import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/database/prisma.module.js';
import { FeesModule } from '../fees/fees.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { InvoicesController } from './invoices.controller.js';
import { PaymentLinkService } from './payment-link.service.js';
import { OfflineGateway } from './gateways/offline.gateway.js';
import { MoyasarGateway } from './gateways/moyasar.gateway.js';
import { PayTabsGateway } from './gateways/paytabs.gateway.js';
import { HyperPayGateway } from './gateways/hyperpay.gateway.js';
import { PaymentGatewayFactory } from './gateways/gateway.factory.js';
import { PaymentReminderProcessor } from './payment-reminder.processor.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhookProcessor } from './webhooks/webhook.processor.js';
import { ReceiptBuilderService } from './receipt/receipt-builder.service.js';
import { ReceiptHookService } from './receipt/receipt-hook.service.js';

/**
 * Plan F — Payments module.
 *
 * Exports:
 *   • PaymentsService          — verify, reject, applyGatewayResult
 *   • PaymentGatewayFactory    — used by other modules if needed
 *   • PaymentLinkService       — issue checkout link for an invoice
 *
 * Crons (gated by env flags in app.config):
 *   • PaymentReminderProcessor (PAYMENT_REMINDER_ENABLED) — hourly
 *   • WebhookProcessor          (PAYMENT_WEBHOOK_PROCESSOR_ENABLED) — every minute
 *
 * ReceiptHookService registers itself on PaymentsService via
 * OnModuleInit, so every verified payment auto-generates a PDF and
 * fires PAYMENT_CONFIRM.
 */
@Module({
  imports: [PrismaModule, FeesModule, NotificationsModule, StorageModule],
  controllers: [PaymentsController, InvoicesController, WebhooksController],
  providers: [
    PaymentsService,
    PaymentLinkService,
    OfflineGateway,
    MoyasarGateway,
    PayTabsGateway,
    HyperPayGateway,
    PaymentGatewayFactory,
    PaymentReminderProcessor,
    WebhookProcessor,
    ReceiptBuilderService,
    ReceiptHookService,
  ],
  exports: [PaymentsService, PaymentGatewayFactory, PaymentLinkService],
})
export class PaymentsModule {}
