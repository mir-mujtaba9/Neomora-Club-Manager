import { Module } from '@nestjs/common';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';

@Module({
    controllers: [RegistrationController],
    providers: [RegistrationService],
    exports: [RegistrationService],
})
export class RegistrationModule { }