import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { decode } from 'jsonwebtoken';
import { JwtPayload } from '../types/jwt-payload.type';
import { RequestWithTenant } from '../types/request-with-tenant.type';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: RequestWithTenant, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.tenantId = null;
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];

    try {
      // Decode the token without verification (verification happens in JwtAuthGuard)
      const decoded = decode(token) as JwtPayload;

      if (decoded) {
        req.tenantId = decoded.tenantId || null;
        req.user = decoded;
      } else {
        req.tenantId = null;
        req.user = null;
      }
    } catch (error) {
      req.tenantId = null;
      req.user = null;
    }

    next();
  }
}
