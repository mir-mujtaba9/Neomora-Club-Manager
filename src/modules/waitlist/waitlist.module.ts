import { Module } from '@nestjs/common';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';
import { WaitlistProcessor } from './waitlist.processor.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';

/**
 * Plan D — full waitlist lifecycle.
 *
 *   * `WaitlistService`   — staff & guardian-token operations
 *   * `WaitlistProcessor` — cron jobs (expire / promote)
 *
 * Imports `NotificationsModule` (for offer-message dispatch) and
 * `EnrolmentsModule` (for `EnrolmentAllocatorService` on accept).
 */
@Module({
  imports: [NotificationsModule, EnrolmentsModule],
  controllers: [WaitlistController],
  providers: [WaitlistService, WaitlistProcessor],
  exports: [WaitlistService],
})
export class WaitlistModule {}
