import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditChainService } from '../../modules/audit/audit-chain.service.js';
import { RequestWithTenant } from '../types/request-with-tenant.type.js';

/**
 * Plan J (F-32) — global write-side audit interceptor.
 *
 * Wired via APP_INTERCEPTOR in AppModule, so every non-GET, non-skipped
 * route automatically produces an AuditLog row through the tamper-evident
 * chain. Inline writers in services (payments/fees/auto-promotion) are
 * preserved because they capture rich before/after state that this
 * generic interceptor can't infer.
 *
 * Notes:
 *  - GETs are skipped (read-only, would flood the table).
 *  - Auth/webhook endpoints are skipped to avoid storing secrets even
 *    after PII masking (login bodies carry passwords + TOTP codes).
 *  - Sensitive keys are scrubbed before the body lands in afterState.
 *  - The resource string is the first path segment after /api/vN.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  /**
   * Path prefixes whose bodies/responses we never want to persist.
   * Login bodies carry plaintext passwords + TOTP codes; webhook bodies
   * are gateway-controlled and may include card metadata.
   */
  private static readonly SKIP_PREFIXES = [
    'auth',
    'webhooks',
    'guardian-auth',
    'audit', // self-reads only; nothing mutating here
  ];

  /**
   * Keys whose VALUES are replaced with '***' wherever they appear in
   * the captured body. Case-insensitive comparison against `key.toLowerCase()`.
   */
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'passwordhash',
    'currentpassword',
    'newpassword',
    'oldpassword',
    'token',
    'accesstoken',
    'refreshtoken',
    'porttaltoken',
    'portaltoken',
    'totpsecret',
    'totpcode',
    'code',
    'secret',
    'apikey',
    'api_key',
    'authorization',
    'cookie',
  ]);

  constructor(private readonly chain: AuditChainService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { method, body, params, ip, tenantId, user } = request;
    const rawPath: string = (request as any).originalUrl || (request as any).url || (request as any).path || '';

    return next.handle().pipe(
      tap(async (responseBody) => {
        // Skip GETs and unidentifiable requests early.
        if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return;
        if (!tenantId) return;

        // Path is like "/api/v1/payments/xxx/verify?foo=bar". Strip the
        // querystring + leading slash, drop "api" and the version
        // segment, then pick the first remaining segment as resource.
        const segments = rawPath
          .split('?')[0]
          .replace(/^\/+/, '')
          .split('/')
          .filter(Boolean);
        // Drop "api" + "vN" prefix if present.
        if (segments[0] === 'api') segments.shift();
        if (/^v\d+$/.test(segments[0] ?? '')) segments.shift();

        const resource = segments[0] || 'unknown';
        if (AuditLogInterceptor.SKIP_PREFIXES.includes(resource)) return;

        // Resource id is either the URL param or the body id or the
        // response id, in that order of trust.
        const resourceId =
          params?.id ||
          (body && typeof body === 'object' && 'id' in body ? (body as any).id : undefined) ||
          (responseBody && typeof responseBody === 'object' && 'id' in responseBody
            ? (responseBody as any).id
            : undefined) ||
          'N/A';

        // Action label captures both verb and the trailing sub-action
        // segment (e.g. "POST verify" for /payments/:id/verify).
        const tail = segments.slice(2).join('/');
        const action = tail ? `${method} ${tail}` : method;

        try {
          await this.chain.write({
            tenantId,
            userId: user?.sub,
            action,
            resource,
            resourceId: String(resourceId),
            ipAddress: ip ?? null,
            // Request body captured (with secrets scrubbed) is the
            // closest generic substitute for true beforeState; the
            // service-side writers carry actual before/after snapshots
            // for the operations that need them.
            afterState: this.scrub(body) as any,
          });
        } catch {
          // AuditChainService already logs internally; nothing to do.
        }
      }),
    );
  }

  /**
   * Recursive shallow clone with sensitive keys masked. Preserves arrays
   * and plain objects only — file buffers / streams skip cleanly through
   * the `typeof !== 'object'` short-circuit.
   */
  private scrub(value: unknown, depth = 0): unknown {
    if (depth > 4) return '[depth-limit]';
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((v) => this.scrub(v, depth + 1));
    if (typeof value !== 'object') return value;
    if (Buffer.isBuffer(value)) return '[buffer]';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (AuditLogInterceptor.SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '***';
      } else {
        out[k] = this.scrub(v, depth + 1);
      }
    }
    return out;
  }
}
