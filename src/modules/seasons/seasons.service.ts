import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrolmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { TERM_STATUS_TRANSITIONS } from '../../common/constants/session-status.constants.js';
import { CreateSeasonDto } from './dto/create-season.dto.js';
import { UpdateSeasonDto } from './dto/update-season.dto.js';
import { FindSeasonsDto } from './dto/find-seasons.dto.js';
import { CreateTermDto } from './dto/create-term.dto.js';
import { UpdateTermDto } from './dto/update-term.dto.js';
import { RenewTermDto } from './dto/renew-term.dto.js';

/** Statuses that represent a confirmed, active enrolment worth carrying into the next term. */
const RENEWABLE_STATUSES: EnrolmentStatus[] = [
  EnrolmentStatus.ACTIVE,
  EnrolmentStatus.FEE_PENDING,
  EnrolmentStatus.DOCUMENTS_PENDING,
];

@Injectable()
export class SeasonsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Seasons ───────────────────────────────────────────────────────────────

  async createSeason(tenantId: string, dto: CreateSeasonDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const existing = await this.prisma.season.findFirst({
      where: { tenantId, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Season with name "${dto.name}" already exists`);
    }

    return this.prisma.season.create({
      data: { tenantId, name: dto.name, startDate: start, endDate: end },
    });
  }

  async findAll(tenantId: string, query: FindSeasonsDto) {
    const { status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.season.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startDate: 'desc' },
        include: {
          _count: { select: { sessions: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.season.count({ where }),
    ]);

    return {
      items: items.map((s) => ({ ...s, termCount: s._count.sessions })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const season = await this.prisma.season.findFirst({
      where: { tenantId, id },
      include: {
        sessions: {
          where: { deletedAt: null },
          orderBy: [{ termNumber: 'asc' }, { startDate: 'asc' }],
          include: {
            sessionLocations: {
              select: {
                id: true,
                locationId: true,
                feeOverride: true,
                location: { select: { id: true, name: true, city: true } },
              },
            },
            _count: {
              select: {
                enrolments: {
                  where: { deletedAt: null, status: { in: RENEWABLE_STATUSES } },
                },
              },
            },
          },
        },
      },
    });

    if (!season) throw new NotFoundException('Season not found');

    return {
      ...season,
      sessions: season.sessions.map((s) => ({
        ...s,
        activeEnrolmentCount: s._count.enrolments,
      })),
    };
  }

  async updateSeason(tenantId: string, id: string, dto: UpdateSeasonDto) {
    await this.assertSeasonExists(tenantId, id);

    if (dto.name) {
      const conflict = await this.prisma.season.findFirst({
        where: { tenantId, name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(`Season with name "${dto.name}" already exists`);
      }
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.status !== undefined) data.status = dto.status;

    if (data.startDate && data.endDate && data.startDate >= data.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    return this.prisma.season.update({ where: { id }, data });
  }

  // ─── Terms ─────────────────────────────────────────────────────────────────

  async createTerm(tenantId: string, seasonId: string, dto: CreateTermDto) {
    const season = await this.assertSeasonExists(tenantId, seasonId);

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!location) {
      throw new BadRequestException('Invalid locationId for this tenant');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const duplicate = await this.prisma.session.findFirst({
      where: {
        tenantId,
        seasonId,
        termNumber: dto.termNumber,
        deletedAt: null,
        sessionLocations: { some: { locationId: dto.locationId } },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Term ${dto.termNumber} already exists for this season at this location`,
      );
    }

    // baseFee is 0 — fee is derived from Program.baseFeePerWeek × totalWeeks at enrolment time
    return this.prisma.session.create({
      data: {
        tenantId,
        name: `${season.name} - Term ${dto.termNumber}`,
        startDate: start,
        endDate: end,
        baseFee: 0 as any,
        seasonId,
        termNumber: dto.termNumber,
        totalWeeks: dto.totalWeeks,
        sessionLocations: { create: { locationId: dto.locationId } },
      },
      include: {
        sessionLocations: {
          include: { location: { select: { id: true, name: true, city: true } } },
        },
      },
    });
  }

  async updateTerm(tenantId: string, seasonId: string, termId: string, dto: UpdateTermDto) {
    await this.assertSeasonExists(tenantId, seasonId);
    const term = await this.assertTermExists(tenantId, seasonId, termId);

    if (dto.status !== undefined) {
      const current = term.status as unknown as string;
      const next = dto.status as unknown as string;
      const allowed = TERM_STATUS_TRANSITIONS[current];

      if (allowed !== next) {
        throw new BadRequestException(
          `Cannot transition term status from ${current} to ${next}. Allowed: ${allowed ?? 'none (terminal state)'}`,
        );
      }
    }

    const data: any = {};
    if (dto.termNumber !== undefined) data.termNumber = dto.termNumber;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.totalWeeks !== undefined) data.totalWeeks = dto.totalWeeks;
    if (dto.status !== undefined) data.status = dto.status;

    return this.prisma.session.update({
      where: { id: termId },
      data,
      include: {
        sessionLocations: {
          include: { location: { select: { id: true, name: true, city: true } } },
        },
      },
    });
  }

  async deleteTerm(tenantId: string, seasonId: string, termId: string) {
    await this.assertSeasonExists(tenantId, seasonId);
    await this.assertTermExists(tenantId, seasonId, termId);

    await this.prisma.session.update({
      where: { id: termId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Renewal ───────────────────────────────────────────────────────────────

  /**
   * Copies all renewable enrolments (ACTIVE / FEE_PENDING / DOCUMENTS_PENDING)
   * from the source term into the target term. Each new enrolment:
   *   - starts at FEE_PENDING (new payment required for new term)
   *   - links back via reEnrolledFromId for audit trail
   *   - fee is recalculated from Program.baseFeePerWeek × targetTerm.totalWeeks
   *     if the programme has a weekly rate; otherwise copies the previous fee
   * Participants already enrolled in the target term are skipped, not errored.
   */
  async renewTerm(tenantId: string, seasonId: string, targetTermId: string, dto: RenewTermDto) {
    await this.assertSeasonExists(tenantId, seasonId);
    await this.assertTermExists(tenantId, seasonId, targetTermId);

    // Resolve target term details needed for fee calculation
    const targetTerm = await this.prisma.session.findFirst({
      where: { id: targetTermId, tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        totalWeeks: true,
        sessionLocations: { select: { locationId: true }, take: 1 },
      },
    });
    if (!targetTerm) throw new NotFoundException('Target term not found');

    const targetStatus = targetTerm.status as unknown as string;
    if (targetStatus !== 'DRAFT' && targetStatus !== 'OPEN') {
      throw new BadRequestException(
        `Target term must be DRAFT or OPEN to accept renewals (current: ${targetStatus})`,
      );
    }

    const targetLocationId = targetTerm.sessionLocations[0]?.locationId ?? null;

    // Resolve source term — must belong to same tenant but can be from any season
    const sourceTerm = await this.prisma.session.findFirst({
      where: { id: dto.sourceTermId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!sourceTerm) throw new NotFoundException('Source term not found');

    if (dto.sourceTermId === targetTermId) {
      throw new BadRequestException('Source and target term must be different');
    }

    // Fetch all renewable enrolments from source term
    const sourceEnrolments = await this.prisma.enrolment.findMany({
      where: {
        tenantId,
        sessionId: dto.sourceTermId,
        deletedAt: null,
        status: { in: RENEWABLE_STATUSES },
      },
      select: {
        id: true,
        participantId: true,
        locationId: true,
        paymentPlanType: true,
        totalFee: true,
        programId: true,
        commitmentLength: true,
        includeKit: true,
      },
    });

    if (sourceEnrolments.length === 0) {
      return {
        renewed: 0,
        skipped: 0,
        message: 'No renewable enrolments found in source term',
        enrolments: [],
      };
    }

    // Pre-fetch rate cards that have a weekly rate, so we only query DB once
    const programIds = [...new Set(sourceEnrolments.map((e) => e.programId).filter(Boolean))] as string[];
    const programMap = new Map<string, any>();

    if (programIds.length > 0) {
      const rateCards = await this.prisma.rateCard.findMany({
        where: {
          programId: { in: programIds },
          deletedAt: null,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      // Pick the first one for each program
      for (const rc of rateCards) {
        if (!programMap.has(rc.programId)) {
          programMap.set(rc.programId, rc);
        }
      }
    }

    // Find participants already enrolled in the target term to skip them
    const alreadyEnrolledIds = new Set(
      (
        await this.prisma.enrolment.findMany({
          where: { tenantId, sessionId: targetTermId, deletedAt: null },
          select: { participantId: true },
        })
      ).map((e) => e.participantId),
    );

    const created: any[] = [];
    let skipped = 0;

    // Use a transaction so all new enrolments land atomically
    await this.prisma.$transaction(async (tx) => {
      for (const src of sourceEnrolments) {
        if (alreadyEnrolledIds.has(src.participantId)) {
          skipped++;
          continue;
        }

        // Calculate fee: use rate card if available, else carry forward
        const rateCard = src.programId ? programMap.get(src.programId) : null;
        const totalFee: Prisma.Decimal =
          rateCard && targetTerm.totalWeeks
            ? (rateCard.weeklyRate as Prisma.Decimal).mul(targetTerm.totalWeeks).add(rateCard.registrationFee).add(rateCard.kitFee)
            : src.totalFee;

        const enrolment = await tx.enrolment.create({
          data: {
            tenantId,
            participantId: src.participantId,
            sessionId: targetTermId,
            locationId: targetLocationId ?? src.locationId,
            reEnrolledFromId: src.id,
            status: EnrolmentStatus.FEE_PENDING,
            paymentPlanType: src.paymentPlanType,
            totalFee,
            paidAmount: new Prisma.Decimal(0),
            balance: totalFee,
            programId: src.programId,
            commitmentLength: src.commitmentLength,
            includeKit: src.includeKit,
            joinDate: new Date(),
          },
          select: {
            id: true,
            participantId: true,
            status: true,
            totalFee: true,
            programId: true,
            reEnrolledFromId: true,
          },
        });

        created.push(enrolment);
      }
    });

    return {
      renewed: created.length,
      skipped,
      message: `${created.length} enrolment(s) renewed, ${skipped} skipped (already enrolled)`,
      enrolments: created,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async assertSeasonExists(tenantId: string, id: string) {
    const season = await this.prisma.season.findFirst({
      where: { tenantId, id },
      select: { id: true, name: true },
    });
    if (!season) throw new NotFoundException('Season not found');
    return season;
  }

  private async assertTermExists(tenantId: string, seasonId: string, termId: string) {
    const term = await this.prisma.session.findFirst({
      where: { id: termId, tenantId, seasonId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!term) throw new NotFoundException('Term not found');
    return term;
  }
}
