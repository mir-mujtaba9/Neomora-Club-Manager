import { Module } from '@nestjs/common';
import { SeasonsController } from './seasons.controller.js';
import { SeasonsService } from './seasons.service.js';

@Module({
  controllers: [SeasonsController],
  providers: [SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
