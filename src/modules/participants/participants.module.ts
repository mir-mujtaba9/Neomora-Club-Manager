import { Module } from '@nestjs/common';
import { ParticipantsController } from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';
import { AutoPromotionService } from './auto-promotion.service.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { StorageModule } from '../storage/storage.module.js';

/**
 * Plan F-11 — AutoPromotionService lives here (rather than in payments)
 * because the FEE_PENDING → ACTIVE rule is fundamentally about
 * participant state. It depends on PaymentsService only to register
 * an onVerifiedHook during OnModuleInit.
 *
 * Plan H — StorageModule is imported so getPortalByToken can sign
 * receipt URLs for the guardian payment-history block.
 */
@Module({
  imports: [EnrolmentsModule, NotificationsModule, PaymentsModule, StorageModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService, AutoPromotionService],
  exports: [ParticipantsService, AutoPromotionService],
})
export class ParticipantsModule {}
