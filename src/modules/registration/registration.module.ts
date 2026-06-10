import { Module } from '@nestjs/common';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';

@Module({
    imports: [EnrolmentsModule],
    controllers: [RegistrationController],
    providers: [RegistrationService],
    exports: [RegistrationService],
})
export class RegistrationModule { }