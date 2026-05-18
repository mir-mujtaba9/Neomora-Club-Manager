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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
