import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/database/prisma.module.js';
import { FeesController } from './fees.controller.js';
import { FeesService } from './fees.service.js';

/**
 * Plan F — Fees module.
 *
 * Exports `FeesService` so other modules (Payments, Reporting) can call
 * `recomputeBalance()` and `setFeeOverride()` directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
