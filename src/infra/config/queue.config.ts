import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redisUrl: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
}));
