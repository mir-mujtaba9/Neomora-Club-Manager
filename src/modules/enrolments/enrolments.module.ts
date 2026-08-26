import { Module } from '@nestjs/common';
import { EnrolmentsController } from './enrolments.controller.js';
import { EnrolmentsService } from './enrolments.service.js';
import { EnrolmentAllocatorService } from './enrolment-allocator.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [EnrolmentsController],
  providers: [EnrolmentsService, EnrolmentAllocatorService],
  exports: [EnrolmentsService, EnrolmentAllocatorService],
})
export class EnrolmentsModule {}
