import { Module } from '@nestjs/common';
import { EnrolmentsController } from './enrolments.controller.js';
import { EnrolmentsService } from './enrolments.service.js';
import { EnrolmentAllocatorService } from './enrolment-allocator.service.js';

@Module({
  controllers: [EnrolmentsController],
  providers: [EnrolmentsService, EnrolmentAllocatorService],
  exports: [EnrolmentsService, EnrolmentAllocatorService],
})
export class EnrolmentsModule {}
