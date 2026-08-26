import { Module } from '@nestjs/common';
import { RateCardsController } from './rate-cards.controller';
import { RateCardsService } from './rate-cards.service';

@Module({
  controllers: [RateCardsController],
  providers: [RateCardsService]
})
export class RateCardsModule {}
