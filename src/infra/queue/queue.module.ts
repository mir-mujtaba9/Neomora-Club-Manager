import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import {
  QUEUE_NOTIFICATIONS,
  QUEUE_PAYMENTS,
  QUEUE_WAITLIST,
  QUEUE_WEBHOOKS,
  QUEUE_PDF,
} from './queue.constants';

const queues = [
  QUEUE_NOTIFICATIONS,
  QUEUE_PAYMENTS,
  QUEUE_WAITLIST,
  QUEUE_WEBHOOKS,
  QUEUE_PDF,
];

const redisUrl = process.env.REDIS_URL;
const redisEnabled = (process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';
const queueEnabled = (process.env.QUEUE_ENABLED ?? 'true').toLowerCase() !== 'false';

const bullImports =
  queueEnabled && redisEnabled && !!redisUrl
    ? [
        BullModule.forRoot({
          connection: {
            url: redisUrl,
          },
        }),
        ...queues.map((name) =>
          BullModule.registerQueue({
            name,
          }),
        ),
      ]
    : [];

@Global()
@Module({
  imports: bullImports,
  exports: bullImports.length ? [BullModule] : [],
})
export class QueueModule {}
