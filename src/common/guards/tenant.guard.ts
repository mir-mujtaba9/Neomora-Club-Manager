import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RequestWithTenant } from '../types/request-with-tenant.type';
import { UserRole } from '../constants/user-role.constants';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { tenantId, user } = request;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    // super admins can access any tenant but MUST have a tenant context selected
    if (user.role === UserRole.SUPER_ADMIN) {
      if (!tenantId) {
        throw new ForbiddenException('Super Admin must provide a tenant context');
      }
      return true;
    }

    if (!tenantId) {
      throw new ForbiddenException('Tenant context is missing');
    }

    if (user.tenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant access is not allowed');
    }

    return true;
  }
}
