import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { ProgramRuleType } from '../../common/constants/program-rule-type.constants.js';
import { CreateProgramDto } from './dto/create-program.dto.js';
import { UpdateProgramDto } from './dto/update-program.dto.js';
import { FindProgramsDto } from './dto/find-programs.dto.js';
import { CreateProgramRuleDto } from './dto/create-program-rule.dto.js';
import { CreateProgramWithRuleDto } from './dto/create-program-with-rule.dto.js';

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

    const program = await this.prisma.program.create({
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

    return this.mapProgram(program);
  }

  async createProgramWithRule(tenantId: string, dto: CreateProgramWithRuleDto) {
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

    const { minBirthYear, maxBirthYear } = this.resolveBirthYearRange(dto.rule);

    return this.prisma.$transaction(async (tx) => {
      const program = await tx.program.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          locationId: dto.locationId ?? null,
          baseFeePerWeek:
            dto.baseFeePerWeek != null ? new Prisma.Decimal(dto.baseFeePerWeek) : null,
        },
      });

      await tx.programRule.create({
        data: {
          tenantId,
          programId: program.id,
          label: dto.rule.label,
          ruleType: (dto.rule.ruleType ?? ProgramRuleType.BIRTH_YEAR_RANGE) as any,
          minBirthYear,
          maxBirthYear,
          sessionsPerWeek: dto.rule.sessionsPerWeek,
          capacity: dto.rule.capacity,
        },
      });

      const created = await tx.program.findUniqueOrThrow({
        where: { id: program.id },
        include: {
          location: { select: { id: true, name: true, city: true } },
          rules: { where: { deletedAt: null }, orderBy: { minBirthYear: 'asc' } },
        },
      });

      return this.mapProgram(created);
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

    return this.mapProgram(program);
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

    const program = await this.prisma.program.update({
      where: { id },
      data,
      include: {
        location: { select: { id: true, name: true, city: true } },
        rules: { where: { deletedAt: null }, orderBy: { minBirthYear: 'asc' } },
      },
    });

    return this.mapProgram(program);
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

    const { minBirthYear, maxBirthYear } = this.resolveBirthYearRange(dto);

    const overlapping = await this.prisma.programRule.findFirst({
      where: {
        programId,
        deletedAt: null,
        minBirthYear: { lte: maxBirthYear },
        maxBirthYear: { gte: minBirthYear },
      },
      select: { id: true, label: true, minBirthYear: true, maxBirthYear: true },
    });
    if (overlapping) {
      throw new ConflictException(
        `Birth year range ${minBirthYear}–${maxBirthYear} overlaps with existing rule "${overlapping.label}" (${overlapping.minBirthYear}–${overlapping.maxBirthYear})`,
      );
    }

    const rule = await this.prisma.programRule.create({
      data: {
        tenantId,
        programId,
        label: dto.label,
        ruleType: (dto.ruleType ?? ProgramRuleType.BIRTH_YEAR_RANGE) as any,
        minBirthYear,
        maxBirthYear,
        sessionsPerWeek: dto.sessionsPerWeek,
        capacity: dto.capacity,
      },
    });

    return this.mapRule(rule);
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

  /** Resolves min/max birth years for storage — EXACT_BIRTH_YEAR collapses to a single-year range. */
  private resolveBirthYearRange(
    rule: Pick<CreateProgramRuleDto, 'ruleType' | 'minBirthYear' | 'maxBirthYear' | 'exactYear'>,
  ): { minBirthYear: number; maxBirthYear: number } {
    if (rule.ruleType === ProgramRuleType.EXACT_BIRTH_YEAR) {
      if (rule.exactYear == null) {
        throw new BadRequestException('exactYear is required when ruleType is EXACT_BIRTH_YEAR');
      }
      return { minBirthYear: rule.exactYear, maxBirthYear: rule.exactYear };
    }

    if (rule.minBirthYear == null || rule.maxBirthYear == null) {
      throw new BadRequestException(
        'minBirthYear and maxBirthYear are required when ruleType is BIRTH_YEAR_RANGE',
      );
    }
    if (rule.minBirthYear > rule.maxBirthYear) {
      throw new BadRequestException('minBirthYear must be <= maxBirthYear');
    }
    return { minBirthYear: rule.minBirthYear, maxBirthYear: rule.maxBirthYear };
  }

  /** Shapes a program rule for API responses — exposes exactYear for EXACT_BIRTH_YEAR rules and nulls out the unused min/max or exact fields. */
  private mapRule<T extends { ruleType: ProgramRuleType | string; minBirthYear: number; maxBirthYear: number }>(
    rule: T,
  ): Omit<T, 'minBirthYear' | 'maxBirthYear'> & {
    minBirthYear: number | null;
    maxBirthYear: number | null;
    exactYear: number | null;
  } {
    const isExact = rule.ruleType === ProgramRuleType.EXACT_BIRTH_YEAR;
    return {
      ...rule,
      minBirthYear: isExact ? null : rule.minBirthYear,
      maxBirthYear: isExact ? null : rule.maxBirthYear,
      exactYear: isExact ? rule.minBirthYear : null,
    };
  }

  private mapProgram<T extends { rules: Array<{ ruleType: ProgramRuleType | string; minBirthYear: number; maxBirthYear: number }> }>(
    program: T,
  ) {
    return { ...program, rules: program.rules.map((rule) => this.mapRule(rule)) };
  }
}
