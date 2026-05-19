import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithTenant } from '../types/request-with-tenant.type';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return request.user;
  },
);
