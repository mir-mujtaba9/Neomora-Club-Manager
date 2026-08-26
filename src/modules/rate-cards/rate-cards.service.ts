import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class RateCardsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: any) {
    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, tenantId, deletedAt: null }
    });
    if (!program) throw new NotFoundException('Program not found');

    return this.prisma.rateCard.create({
      data: {
        tenantId,
        programId: dto.programId,
        weeklyRate: dto.weeklyRate,
        registrationFee: dto.registrationFee ?? 0,
        kitFee: dto.kitFee ?? 0,
        minBillableWeeks: dto.minBillableWeeks ?? 1,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      }
    });
  }

  async findAll(tenantId: string, programId?: string, page: number = 1, limit: number = 20) {
    const where: any = { tenantId, deletedAt: null };
    if (programId) where.programId = programId;

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.rateCard.findMany({
        where,
        skip,
        take: limit,
        orderBy: { effectiveFrom: 'desc' },
        include: { program: { select: { id: true, name: true, code: true } } },
      }),
      this.prisma.rateCard.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async remove(tenantId: string, id: string) {
    const rateCard = await this.prisma.rateCard.findFirst({
      where: { id, tenantId, deletedAt: null }
    });
    if (!rateCard) throw new NotFoundException('RateCard not found');

    return this.prisma.rateCard.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }
}
