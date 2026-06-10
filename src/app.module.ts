import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
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
import { DocumentsModule } from './modules/documents/documents.module.js';
import { EnrolmentsModule } from './modules/enrolments/enrolments.module.js';
import { WaitlistModule } from './modules/waitlist/waitlist.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { RegistrationModule } from './modules/registration/registration.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FeesModule } from './modules/fees/fees.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

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
    // Plan D — enables `@Cron` decorators (waitlist promote/expire).
    // Individual processors are still gated by their own enabled flag.
    ScheduleModule.forRoot(),
    // Plan E — i18n for bilingual (en/ar) validation messages. Language
    // is resolved per request from (in order) the `?lang=` query string,
    // an `x-lang` header, then the standard `Accept-Language` header.
    // JSON files live in src/i18n/{en,ar}/ and are copied to dist/ at
    // build time via nest-cli.json's assets config.
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: join(__dirname, '/i18n/'),
        watch: true,
      },
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        new HeaderResolver(['x-lang']),
        AcceptLanguageResolver,
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
    DocumentsModule,
    UsersModule,
    WaitlistModule,
    ReportingModule,
    RegistrationModule,
    NotificationsModule,
    FeesModule,
    PaymentsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
