import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly _client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is required');
    }

    this._client = new Redis(redisUrl);

    this._client.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this._client.on('connect', () => {
      this.logger.log('Successfully connected to Redis');
    });
  }

  get client(): Redis {
    return this._client;
  }

  async onModuleDestroy() {
    await this._client.quit();
  }
}
