import { Module } from '@nestjs/common';
import { ParticipantsController } from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [EnrolmentsModule, NotificationsModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService],
  exports: [ParticipantsService],
})
export class ParticipantsModule {}
