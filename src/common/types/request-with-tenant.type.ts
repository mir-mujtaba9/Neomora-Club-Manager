import { Request } from 'express';
import { JwtPayload } from './jwt-payload.type';

export interface RequestWithTenant extends Request {
  /** The tenant context ID extracted from the request (header or subdomain) */
  tenantId: string | null;
  /** The authenticated user payload from the JWT */
  user: any; // Using any to avoid conflict with Express.User while allowing JwtPayload
}
