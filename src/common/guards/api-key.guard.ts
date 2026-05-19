import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { hashApiKey } from '../utils/hmac.util';
import { RequestWithTenant } from '../types/request-with-tenant.type';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    const keyHash = hashApiKey(apiKey);

    const keyRecord = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        tenantId: true,
        revokedAt: true,
      },
    });

    if (!keyRecord) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (keyRecord.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    // Stamp tenantId on request for downstream usage
    request.tenantId = keyRecord.tenantId;

    // Update last used timestamp (async, don't block request)
    this.updateLastUsed(keyHash);

    return true;
  }

  private async updateLastUsed(keyHash: string) {
    try {
      await this.prisma.apiKey.update({
        where: { keyHash },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      // Log error but don't fail request
      console.error('Failed to update API key last used at:', error);
    }
  }
}
