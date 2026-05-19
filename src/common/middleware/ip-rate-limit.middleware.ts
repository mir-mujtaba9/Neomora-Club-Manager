import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../../infra/cache/redis.service';

@Injectable()
export class IPRateLimitMiddleware implements NestMiddleware {
  private readonly WINDOW_SIZE_IN_SECONDS = 60;
  private readonly MAX_REQUESTS = 20;

  constructor(private readonly redisService: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.redisService.isEnabled) {
      return next();
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const key = `ratelimit:ip:${ip}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE_IN_SECONDS * 1000;

    const redis = this.redisService.client;

    try {
      // Use Redis transaction to implement sliding window
      const result = await redis
        .multi()
        .zremrangebyscore(key, 0, windowStart) // Remove old timestamps
        .zadd(key, now, now.toString())        // Add current timestamp
        .zcard(key)                            // Get count of requests in window
        .expire(key, this.WINDOW_SIZE_IN_SECONDS) // Set expiration for cleanup
        .exec();

      if (!result) {
        return next();
      }

      const count = result[2][1] as number;

      if (count > this.MAX_REQUESTS) {
        throw new HttpException(
          'Too many requests. Please try again after a minute.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Log error and allow request if Redis fails (fail-open strategy)
      console.error('Rate limit redis error:', error);
      next();
    }
  }
}
