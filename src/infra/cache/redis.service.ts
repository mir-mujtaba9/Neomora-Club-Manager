import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly _client: Redis;
  private readonly _enabled: boolean;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    const redisEnabled = (process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';

    this._enabled = redisEnabled && !!redisUrl;

    if (!this._enabled) {
      // Keep a client instance for DI compatibility, but don't connect.
      const options: RedisOptions = {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
      };
      this._client = new Redis(options);
      this.logger.warn('Redis is disabled (set REDIS_ENABLED=true to enable).');
      return;
    }

    const url = redisUrl as string;
    this._client = new Redis(url);

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

  get isEnabled(): boolean {
    return this._enabled;
  }

  async onModuleDestroy() {
    if (!this._enabled) return;
    await this._client.quit();
  }
}
