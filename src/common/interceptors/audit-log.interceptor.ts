import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../infra/database/prisma.service';
import { RequestWithTenant } from '../types/request-with-tenant.type';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { method, path, params, body, ip, tenantId, user } = request;

    return next.handle().pipe(
      tap(async (responseBody) => {
        // Skip GET requests for auditing to keep logs clean
        if (method === 'GET') return;

        try {
          // Determine resource from path (e.g., /participants -> participants)
          const resource = path.split('/')[1] || 'unknown';
          const resourceId = params?.id || body?.id || 'N/A';

          if (!tenantId) {
            return;
          }

          await this.prisma.auditLog.create({
            data: {
              tenantId,
              userId: user?.sub,
              action: `${method} ${path}`,
              resource,
              resourceId: String(resourceId),
              ipAddress: ip,
              // beforeState: null, // Hard to capture generically without more complex logic
              afterState: responseBody && typeof responseBody === 'object' ? { id: responseBody.id } : {},
            },
          });
        } catch (error) {
          console.error('Audit log creation failed:', error);
        }
      }),
    );
  }
}
