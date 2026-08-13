import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { CreateProgramDto } from './dto/create-program.dto.js';
import { UpdateProgramDto } from './dto/update-program.dto.js';
import { FindProgramsDto } from './dto/find-programs.dto.js';
import { CreateProgramRuleDto } from './dto/create-program-rule.dto.js';

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProgram(tenantId: string, dto: CreateProgramDto) {
    if (dto.locationId) {
      await this.assertValidLocation(tenantId, dto.locationId);
    }

    const existing = await this.prisma.program.findFirst({
      where: { tenantId, code: dto.code, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Program with code "${dto.code}" already exists`);
    }

    return this.prisma.program.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        locationId: dto.locationId ?? null,
        baseFeePerWeek:
          dto.baseFeePerWeek != null
            ? new Prisma.Decimal(dto.baseFeePerWeek)
            : null,
      },
      include: {
        location: { select: { id: true, name: true, city: true } },
        rules: { where: { deletedAt: null }, orderBy: { minBirthYear: 'asc' } },
      },
    });
  }

  async findAll(tenantId: string, query: FindProgramsDto) {
    const { locationId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId, deletedAt: null };

    if (locationId === 'none') {
      where.locationId = null;
    } else if (locationId) {
      where.locationId = locationId;
    }

    const [items, total] = await Promise.all([
      this.prisma.program.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          location: { select: { id: true, name: true, city: true } },
          _count: { select: { rules: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.program.count({ where }),
    ]);

    return {
      items: items.map((p) => ({ ...p, ruleCount: p._count.rules })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const program = await this.prisma.program.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        location: { select: { id: true, name: true, city: true } },
        rules: {
          where: { deletedAt: null },
          orderBy: { minBirthYear: 'asc' },
        },
      },
    });

    if (!program) throw new NotFoundException('Program not found');

    return program;
  }

  async updateProgram(tenantId: string, id: string, dto: UpdateProgramDto) {
    await this.assertProgramExists(tenantId, id);

    if (dto.locationId) {
      await this.assertValidLocation(tenantId, dto.locationId);
    }

    if (dto.code) {
      const conflict = await this.prisma.program.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(`Program with code "${dto.code}" already exists`);
      }
    }

    const data: any = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if ('locationId' in dto) data.locationId = dto.locationId ?? null;
    if ('baseFeePerWeek' in dto) {
      data.baseFeePerWeek =
        dto.baseFeePerWeek != null ? new Prisma.Decimal(dto.baseFeePerWeek) : null;
    }

    return this.prisma.program.update({
      where: { id },
      data,
      include: {
        location: { select: { id: true, name: true, city: true } },
        rules: { where: { deletedAt: null }, orderBy: { minBirthYear: 'asc' } },
      },
    });
  }

  async softDeleteProgram(tenantId: string, id: string) {
    await this.assertProgramExists(tenantId, id);
    await this.prisma.program.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addRule(tenantId: string, programId: string, dto: CreateProgramRuleDto) {
    await this.assertProgramExists(tenantId, programId);

    if (dto.minBirthYear > dto.maxBirthYear) {
      throw new BadRequestException('minBirthYear must be <= maxBirthYear');
    }

    const overlapping = await this.prisma.programRule.findFirst({
      where: {
        programId,
        deletedAt: null,
        minBirthYear: { lte: dto.maxBirthYear },
        maxBirthYear: { gte: dto.minBirthYear },
      },
      select: { id: true, label: true, minBirthYear: true, maxBirthYear: true },
    });
    if (overlapping) {
      throw new ConflictException(
        `Birth year range ${dto.minBirthYear}–${dto.maxBirthYear} overlaps with existing rule "${overlapping.label}" (${overlapping.minBirthYear}–${overlapping.maxBirthYear})`,
      );
    }

    return this.prisma.programRule.create({
      data: {
        tenantId,
        programId,
        label: dto.label,
        ruleType: (dto.ruleType ?? 'BIRTH_YEAR_RANGE') as any,
        minBirthYear: dto.minBirthYear,
        maxBirthYear: dto.maxBirthYear,
        sessionsPerWeek: dto.sessionsPerWeek,
        capacity: dto.capacity,
      },
    });
  }

  async removeRule(tenantId: string, programId: string, ruleId: string) {
    await this.assertProgramExists(tenantId, programId);

    const rule = await this.prisma.programRule.findFirst({
      where: { id: ruleId, programId, deletedAt: null },
      select: { id: true },
    });
    if (!rule) throw new NotFoundException('Program rule not found');

    await this.prisma.programRule.update({
      where: { id: ruleId },
      data: { deletedAt: new Date() },
    });
  }

  private async assertProgramExists(tenantId: string, id: string) {
    const program = await this.prisma.program.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!program) throw new NotFoundException('Program not found');
    return program;
  }

  private async assertValidLocation(tenantId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!location) {
      throw new BadRequestException('Invalid locationId for this tenant');
    }
  }
}
