import { Module } from '@nestjs/common';
import { VatRatesController } from './vat-rates.controller.js';
import { VatRatesService } from './vat-rates.service.js';
import { PrismaModule } from '../../infra/database/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [VatRatesController],
  providers: [VatRatesService],
  exports: [VatRatesService],
})
export class VatRatesModule {}
