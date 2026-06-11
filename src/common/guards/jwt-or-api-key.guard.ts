/**
 * Plan K (F-34) — Dual authentication guard accepting either:
 *   - `Authorization: Bearer <jwt>` (standard staff/user flow)
 *   - `x-api-key: <plaintext>` (machine-to-machine / partner flow)
 *
 * If `x-api-key` is present we short-circuit JWT validation entirely.
 * Otherwise we delegate to passport-jwt (same code path as JwtAuthGuard).
 *
 * On successful API-key auth we stamp:
 *   request.user = {
 *     sub: <apiKeyId>,
 *     tenantId: <apiKey.tenantId>,
 *     role: API_KEY_ROLE,        // synthetic, distinct from UserRole enum
 *     scopes: <apiKey.scopes>,   // e.g. ['participants:read', '*']
 *     isApiKey: true,
 *   }
 *   request.tenantId = <apiKey.tenantId>
 *
 * Per-API-key rate limiting (sliding window via Redis) runs here too,
 * BEFORE the handler is dispatched. Limits are enforced as `<rateLimit>
 * requests / hour` where `rateLimit` comes from the key row (default 1000).
 *
 * Why combine into one guard instead of chaining?
 *   Chained `@UseGuards(JwtAuthGuard, ApiKeyGuard)` would require BOTH to
 *   pass (AND-semantics in Nest). We want OR-semantics.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

import { hashApiKey } from '../utils/hmac.util.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { RedisService } from '../../infra/cache/redis.service.js';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator.js';
import { API_KEY_ROLE } from '../decorators/api-scope.decorator.js';
import { RequestWithTenant } from '../types/request-with-tenant.type.js';

@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard('jwt') implements CanActivate {
  private readonly logger = new Logger(JwtOrApiKeyGuard.name);

  /** API-key rate-limit window in seconds (1 hour). */
  private readonly WINDOW_SECONDS = 60 * 60;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Honour `@Public()` exactly like JwtAuthGuard does.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const apiKeyHeader = request.headers['x-api-key'];

    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      return this.authenticateApiKey(request, apiKeyHeader);
    }

    // No API key — fall back to standard JWT.
    const result = super.canActivate(context);
    // `AuthGuard` may return boolean | Promise<boolean> | Observable<boolean>.
    if (result instanceof Observable) {
      return new Promise<boolean>((resolve, reject) => {
        result.subscribe({ next: resolve, error: reject });
      });
    }
    return result as boolean | Promise<boolean>;
  }

  /**
   * Lookup → validate → rate-limit → stamp request. Throws 401/429.
   */
  private async authenticateApiKey(
    request: RequestWithTenant,
    plaintext: string,
  ): Promise<boolean> {
    const keyHash = hashApiKey(plaintext);

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        tenantId: true,
        revokedAt: true,
        scopes: true,
        rateLimit: true,
      },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (record.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    // Per-key sliding-window throttle. When Redis is disabled we skip the
    // check (dev convenience) — production should always have Redis on.
    if (this.redis.isEnabled && record.rateLimit > 0) {
      const allowed = await this.checkRateLimit(record.id, record.rateLimit);
      if (!allowed) {
        throw new HttpException(
          `API key rate limit exceeded (${record.rateLimit} req/hour)`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Stamp synthetic identity on the request. Downstream `RolesGuard`
    // sees `role: API_KEY_ROLE` and switches to scope-based authorization.
    request.tenantId = record.tenantId;
    request.user = {
      sub: record.id,
      tenantId: record.tenantId,
      role: API_KEY_ROLE,
      scopes: record.scopes,
      isApiKey: true,
      // locationId is intentionally null — API keys are tenant-scoped, not
      // location-scoped. LM-style auto-scoping does not apply.
      locationId: null,
    };

    // Fire-and-forget bump of lastUsedAt — never block the request.
    this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch((err) => this.logger.warn(`lastUsedAt bump failed: ${err?.message}`));

    return true;
  }

  /**
   * Sliding-window rate limiter. Returns true when the request is allowed.
   * Uses ZADD/ZRANGEBYSCORE/ZREMRANGEBYSCORE — same algorithm as
   * IPRateLimitMiddleware but with a per-key bucket.
   */
  private async checkRateLimit(apiKeyId: string, limit: number): Promise<boolean> {
    const key = `ratelimit:apikey:${apiKeyId}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SECONDS * 1000;

    try {
      const result = await this.redis.client
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, `${now}-${Math.random()}`)
        .zcard(key)
        .expire(key, this.WINDOW_SECONDS)
        .exec();

      if (!result) {
        return true; // Redis returned no result — fail open
      }
      const count = result[2][1] as number;
      return count <= limit;
    } catch (err) {
      // Fail open on Redis errors so a degraded cache doesn't block paid
      // traffic. The logger surfaces the issue for ops.
      this.logger.error(`Rate-limit check failed: ${(err as Error).message}`);
      return true;
    }
  }
}
