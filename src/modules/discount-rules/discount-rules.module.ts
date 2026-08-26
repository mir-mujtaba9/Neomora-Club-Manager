import { Module } from '@nestjs/common';
import { DiscountRulesController } from './discount-rules.controller.js';
import { DiscountRulesService } from './discount-rules.service.js';
import { PrismaModule } from '../../infra/database/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [DiscountRulesController],
  providers: [DiscountRulesService],
  exports: [DiscountRulesService],
})
export class DiscountRulesModule {}
