import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { IPRateLimitMiddleware } from './common/middleware/ip-rate-limit.middleware.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';
import { PrismaModule } from './infra/database/prisma.module';
import { RedisModule } from './infra/cache/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import appConfig from './infra/config/app.config';
import databaseConfig from './infra/config/database.config';
import jwtConfig from './infra/config/jwt.config';
import storageConfig from './infra/config/storage.config';
import queueConfig from './infra/config/queue.config';
import { AuditModule } from './modules/audit/audit.module.js';
import { GuardiansModule } from './modules/guardians/guardians.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
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
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { SeasonsModule } from './modules/seasons/seasons.module.js';
import { ProgramsModule } from './modules/programs/programs.module.js';
import { FamiliesModule } from './modules/families/families.module.js';
import { RateCardsModule } from './modules/rate-cards/rate-cards.module.js';
import { DiscountRulesModule } from './modules/discount-rules/discount-rules.module.js';
import { VatRatesModule } from './modules/vat-rates/vat-rates.module.js';

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
    // Plan J — must be imported BEFORE the modules that depend on
    // AuditChainService (it's @Global so order matters only at registration).
    AuditModule,
    AuthModule,
    GuardianAuthModule,
    GuardiansModule,
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
    // Plan L — staff-only daily attendance tracking.
    AttendanceModule,
    // Plan K (F-34) — partner API key management. JWT-only controller,
    // SUPER_ADMIN role required. The matching `JwtOrApiKeyGuard` lives
    // in common/ so partner controllers can use it without importing.
    ApiKeysModule,
    SeasonsModule,
    ProgramsModule,
    FamiliesModule,
    RateCardsModule,
    DiscountRulesModule,
    VatRatesModule,
  ],
  providers: [
    // Plan J (F-32) — global audit interceptor. Writes one tamper-evident
    // AuditLog row per non-GET request through AuditChainService. Service-
    // level inline writes still happen for operations that need rich
    // before/after snapshots.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');

    // Plan K (F-34) — IP-based rate limiting on auth + public registration
    // routes. Sliding window of 20 requests / 60 seconds per IP. When
    // Redis is disabled the middleware is a no-op (dev convenience).
    // The default Nest middleware path resolver respects the global
    // prefix + versioning, so `auth/login` matches `/api/v1/auth/login`.
    consumer
      .apply(IPRateLimitMiddleware)
      .forRoutes(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/refresh', method: RequestMethod.POST },
        { path: 'auth/forgot-password', method: RequestMethod.POST },
        { path: 'auth/reset-password', method: RequestMethod.POST },
        { path: 'auth/2fa/setup', method: RequestMethod.POST },
        { path: 'auth/2fa/enable', method: RequestMethod.POST },
        { path: 'auth/2fa/disable', method: RequestMethod.POST },
        { path: 'guardian-auth/request-link', method: RequestMethod.POST },
        { path: 'guardian-auth/verify', method: RequestMethod.POST },
        { path: 'participants/register', method: RequestMethod.POST },
        { path: 'register/*', method: RequestMethod.POST },
      );
  }
}
