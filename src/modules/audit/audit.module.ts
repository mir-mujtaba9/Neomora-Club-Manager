import { Global, Module } from '@nestjs/common';
import { AuditChainService } from './audit-chain.service.js';
import { AuditController } from './audit.controller.js';

/**
 * Plan J (F-32) — global so AuditLogInterceptor (registered via
 * APP_INTERCEPTOR in AppModule) and any service that wants to write
 * audit rows can inject AuditChainService without re-importing.
 */
@Global()
@Module({
  providers: [AuditChainService],
  controllers: [AuditController],
  exports: [AuditChainService],
})
export class AuditModule {}
