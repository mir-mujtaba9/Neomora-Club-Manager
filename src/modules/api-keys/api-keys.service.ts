import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { hashApiKey } from '../../common/utils/hmac.util.js';

import { CreateApiKeyDto } from './dto/create-api-key.dto.js';

/**
 * Plan K (F-34) — API-key lifecycle. Plaintext keys are returned EXACTLY
 * ONCE at creation time; subsequent lookups expose only metadata
 * (label, scopes, lastUsedAt, revokedAt). The DB stores `HMAC-SHA256(key)`
 * keyed by `API_KEY_SECRET`, so a DB leak does not yield usable keys
 * without the application secret.
 *
 * Key format: `nm_<48-hex-chars>` (24 random bytes hex-encoded). The
 * `nm_` prefix is purely cosmetic — the lookup hashes the entire string
 * including the prefix, so trimming would invalidate the key.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    tenantId: string,
    createdById: string,
    dto: CreateApiKeyDto,
  ): Promise<{
    id: string;
    plaintext: string;
    label: string;
    scopes: string[];
    rateLimit: number;
    createdAt: Date;
  }> {
    const plaintext = `nm_${randomBytes(24).toString('hex')}`;
    const keyHash = hashApiKey(plaintext);
    const rateLimit = dto.rateLimit ?? 1000;

    if (dto.scopes.includes('*')) {
      this.logger.warn(
        `Wildcard scope "*" issued for tenant=${tenantId} by user=${createdById}`,
      );
    }

    const row = await this.prisma.apiKey.create({
      data: {
        tenantId,
        createdById,
        keyHash,
        label: dto.label,
        scopes: dto.scopes,
        rateLimit,
      },
      select: {
        id: true,
        label: true,
        scopes: true,
        rateLimit: true,
        createdAt: true,
      },
    });

    return {
      id: row.id,
      // ── Plaintext shown ONCE. Caller is responsible for storing it. ──
      plaintext,
      label: row.label,
      scopes: row.scopes,
      rateLimit: row.rateLimit,
      createdAt: row.createdAt,
    };
  }

  async findAll(tenantId: string) {
    const items = await this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, email: true, fullName: true } },
      },
    });
    return { items, total: items.length };
  }

  /**
   * Soft revoke — sets `revokedAt`. The guard already filters on this
   * so the key stops working immediately. We never hard-delete because
   * the audit chain references the key id.
   */
  async revoke(tenantId: string, id: string): Promise<{ success: true; id: string; revokedAt: Date }> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }
    if (existing.revokedAt) {
      return { success: true, id: existing.id, revokedAt: existing.revokedAt };
    }
    const now = new Date();
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: now },
    });
    return { success: true, id, revokedAt: now };
  }
}
