import { Module } from '@nestjs/common';

import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';
import { SessionAutoStatusProcessor } from './session-auto-status.processor.js';

@Module({
	controllers: [SessionsController],
	providers: [SessionsService, SessionAutoStatusProcessor],
	exports: [SessionsService],
})
export class SessionsModule {}
