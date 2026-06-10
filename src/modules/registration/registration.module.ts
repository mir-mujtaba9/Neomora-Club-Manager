import { Module } from '@nestjs/common';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
    imports: [EnrolmentsModule, NotificationsModule],
    controllers: [RegistrationController],
    providers: [RegistrationService],
    exports: [RegistrationService],
})
export class RegistrationModule { }