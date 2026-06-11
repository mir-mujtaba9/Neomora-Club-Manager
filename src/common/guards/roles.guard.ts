import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { API_KEY_ROLE, API_SCOPES_KEY } from '../decorators/api-scope.decorator.js';
import { UserRole } from '../constants/user-role.constants';
import { RequestWithTenant } from '../types/request-with-tenant.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Read scope metadata up-front — used by both branches below.
    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(API_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const { user } = context.switchToHttp().getRequest<RequestWithTenant>();

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: No user profile found');
    }

    // Plan K (F-34) — API-key callers bypass `@Roles` checks entirely
    // and are gated by `@ApiScopes` instead. An endpoint that lacks
    // `@ApiScopes` is implicitly closed to API keys, regardless of
    // whether `@Roles` would have matched.
    if (user.role === API_KEY_ROLE) {
      if (requiredScopes.length === 0) {
        throw new ForbiddenException(
          'Access denied: this endpoint is not available to API keys',
        );
      }
      const userScopes: string[] = Array.isArray(user.scopes) ? user.scopes : [];
      const hasScope =
        userScopes.includes('*') ||
        requiredScopes.some((scope) => userScopes.includes(scope));
      if (!hasScope) {
        throw new ForbiddenException(
          `Access denied: API key missing required scope(s) [${requiredScopes.join(', ')}]`,
        );
      }
      return true;
    }

    if (!requiredRoles) {
      return true;
    }

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      throw new ForbiddenException(`Access denied: Requires one of [${requiredRoles.join(', ')}]`);
    }

    return true;
  }
}
