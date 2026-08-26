import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class DiscountRulesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: any) {
    if (dto.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: dto.programId, tenantId, deletedAt: null }
      });
      if (!program) throw new NotFoundException('Program not found');
    }

    return this.prisma.discountRule.create({
      data: {
        tenantId,
        ruleType: dto.ruleType,
        programId: dto.programId || null,
        percentage: dto.percentage,
        minWeeks: dto.minWeeks || null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      }
    });
  }

  async findAll(tenantId: string, programId?: string, page: number = 1, limit: number = 20) {
    const where: any = { tenantId };
    if (programId) where.programId = programId;

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.discountRule.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { program: { select: { id: true, name: true, code: true } } },
      }),
      this.prisma.discountRule.count({ where }),
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
    const rule = await this.prisma.discountRule.findFirst({
      where: { id, tenantId }
    });
    if (!rule) throw new NotFoundException('DiscountRule not found');

    return this.prisma.discountRule.delete({
      where: { id }
    });
  }

  async toggle(tenantId: string, id: string) {
    const rule = await this.prisma.discountRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('DiscountRule not found');
    return this.prisma.discountRule.update({
      where: { id },
      data: { isActive: !rule.isActive }
    });
  }
}
