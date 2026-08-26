import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class VatRatesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.vatRate.findMany({
      where: { tenantId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async schedule(tenantId: string, dto: { rate: number; effectiveFrom: string }) {
    const effectiveDate = new Date(dto.effectiveFrom);
    if (isNaN(effectiveDate.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const now = new Date();
    // Only allow scheduling future rates
    if (effectiveDate <= now) {
      throw new BadRequestException('effectiveFrom must be in the future');
    }

    // Delete any existing future rates for this tenant (enforce 1 future rate)
    await this.prisma.vatRate.deleteMany({
      where: {
        tenantId,
        effectiveFrom: { gt: now },
      },
    });

    return this.prisma.vatRate.create({
      data: {
        tenantId,
        rate: dto.rate,
        effectiveFrom: effectiveDate,
      },
    });
  }

  async getActiveMultiplier(tenantId: string, tx?: any): Promise<any> {
    const client = tx || this.prisma;
    const active = await client.vatRate.findFirst({
      where: { tenantId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    
    // Fallback to 0 if no VAT is configured
    const rate = active?.rate ? Number(active.rate) : 0;
    return 1 + (rate / 100);
  }
}
