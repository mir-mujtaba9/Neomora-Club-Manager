import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { ParticipantsModule } from '../participants/participants.module.js';

@Module({
  imports: [ParticipantsModule],
  controllers: [PortalController],
})
export class PortalModule {}
