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

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL,
      },
    }),
    ...queues.map((name) =>
      BullModule.registerQueue({
        name,
      }),
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
