import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { PrismaModule } from './infra/database/prisma.module';
import { RedisModule } from './infra/cache/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import appConfig from './infra/config/app.config';
import databaseConfig from './infra/config/database.config';
import jwtConfig from './infra/config/jwt.config';
import storageConfig from './infra/config/storage.config';
import queueConfig from './infra/config/queue.config';
import { AuthModule } from './modules/auth/auth.module';
import { GuardianAuthModule } from './modules/auth/guardian-auth.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ParticipantsModule } from './modules/participants/participants.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { EnrolmentsModule } from './modules/enrolments/enrolments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        storageConfig,
        queueConfig,
      ],
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    GuardianAuthModule,
    LocationsModule,
    SessionsModule,
    ParticipantsModule,
    PortalModule,
    EnrolmentsModule,
    UsersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
