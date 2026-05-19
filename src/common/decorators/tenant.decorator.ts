import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithTenant } from '../types/request-with-tenant.type';

export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return request.tenantId;
  },
);
