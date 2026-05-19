import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RequestWithTenant } from '../types/request-with-tenant.type';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { tenantId, user } = request;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context is missing');
    }

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    // super admins can bypass tenant check if needed, but usually they are scoped to a tenant
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    if (user.tenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant access is not allowed');
    }

    return true;
  }
}
