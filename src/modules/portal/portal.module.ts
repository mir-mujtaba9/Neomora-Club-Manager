import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { ParticipantsModule } from '../participants/participants.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [ParticipantsModule, NotificationsModule],
  controllers: [PortalController],
})
export class PortalModule {}
