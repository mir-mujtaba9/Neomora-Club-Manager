import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { EnrolmentAllocatorService } from './enrolment-allocator.service.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { ReEnrolDto } from './dto/re-enrol.dto.js';
import { FindEnrolmentsDto } from './dto/find-enrolments.dto.js';
import { CalculateFeeDto } from './dto/calculate-fee.dto.js';
import { StaffRegisterDto } from './dto/staff-register.dto.js';
import { GetAvailableTermsDto } from './dto/get-available-terms.dto.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';
import { generateUniqueId } from '../../common/utils/unique-id.util.js';

@Injectable()
export class EnrolmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocator: EnrolmentAllocatorService,
  ) {}

  // â”€â”€â”€ Overlap guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async assertNoOverlap(
    tenantId: string,
    participantId: string,
    targetSessionId: string,
    options: { allowOverlap?: boolean; excludeEnrolmentId?: string } = {},
  ): Promise<void> {
    if (options.allowOverlap) return;

    const target = await this.prisma.session.findFirst({
      where: { id: targetSessionId, tenantId, deletedAt: null },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!target) throw new NotFoundException('Session not found');

    const overlap = await this.prisma.enrolment.findFirst({
      where: {
        tenantId,
        participantId,
        deletedAt: null,
        ...(options.excludeEnrolmentId && { NOT: { id: options.excludeEnrolmentId } }),
        status: { in: ['ACTIVE', 'FEE_PENDING', 'DOCUMENTS_PENDING'] },
        session: {
          startDate: { lte: target.endDate },
          endDate:   { gte: target.startDate },
          deletedAt: null,
        },
      },
      select: { id: true, sessionId: true, status: true },
    });

    if (overlap) {
      throw new ConflictException(
        `Participant already has an active enrolment (${overlap.id}) whose session overlaps. Pass allowOverlap=true to override.`,
      );
    }
  }

  // â”€â”€â”€ Enrol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async enrol(
    tenantId: string,
    user: any,
    dto: CreateEnrolmentDto,
    options: { allowOverlap?: boolean } = {},
  ) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: dto.participantId, tenantId, deletedAt: null },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    const session = await this.prisma.session.findFirst({
      where: { id: dto.sessionId, tenantId, deletedAt: null },
      include: { sessionLocations: { where: { locationId: dto.locationId } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.sessionLocations?.length) {
      throw new BadRequestException('Session is not offered at the specified location');
    }

    if (dto.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: dto.programId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!program) throw new NotFoundException('Program not found');
    }

    if (user?.role === UserRole.LOCATION_MANAGER) {
      if (user.locationId !== dto.locationId) {
        throw new ForbiddenException('Location managers can only enrol in their assigned location');
      }
      if (participant.locationId !== user.locationId) {
        throw new ForbiddenException('Location managers can only enrol participants from their location');
      }
    }

    const existingEnrolment = await this.prisma.enrolment.findFirst({
      where: {
        tenantId,
        participantId: dto.participantId,
        sessionId: dto.sessionId,
        locationId: dto.locationId,
        deletedAt: null,
      },
    });
    if (existingEnrolment) {
      throw new BadRequestException('Participant is already enrolled in this session at this location');
    }

    const existingWaitlist = await this.prisma.waitlist.findFirst({
      where: {
        tenantId,
        participantId: dto.participantId,
        sessionId: dto.sessionId,
        locationId: dto.locationId,
        deletedAt: null,
      },
    });
    if (existingWaitlist) {
      throw new BadRequestException('Participant is already on the waitlist for this session');
    }

    await this.assertNoOverlap(tenantId, dto.participantId, dto.sessionId, {
      allowOverlap: options.allowOverlap,
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const allocation = await this.allocator.allocate(tx, {
          tenantId,
          participantId: dto.participantId,
          sessionId: dto.sessionId,
          locationId: dto.locationId,
          paymentPlanType: dto.paymentPlanType,
          programId: dto.programId,
        });

        if (allocation.outcome === 'ENROLLED') {
          return { status: 'ENROLLED', enrolment: allocation.enrolment };
        }
        return { status: 'WAITLISTED', waitlist: allocation.waitlist };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    return result;
  }

  // â”€â”€â”€ Re-enrol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async reEnrol(
    tenantId: string,
    user: any,
    previousEnrolmentId: string,
    dto: ReEnrolDto,
    options: { allowOverlap?: boolean } = {},
  ) {
    const previousEnrolment = await this.prisma.enrolment.findFirst({
      where: { id: previousEnrolmentId, tenantId, deletedAt: null },
    });
    if (!previousEnrolment) throw new NotFoundException('Previous enrolment not found');

    const participantId = previousEnrolment.participantId;
    const locationId    = previousEnrolment.locationId;

    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, tenantId, deletedAt: null },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    const session = await this.prisma.session.findFirst({
      where: { id: dto.sessionId, tenantId, deletedAt: null },
      include: { sessionLocations: { where: { locationId } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.sessionLocations?.length) {
      throw new BadRequestException('Session is not offered at the specified location');
    }

    if (user?.role === UserRole.LOCATION_MANAGER && user.locationId !== locationId) {
      throw new ForbiddenException('Location managers can only re-enrol in their assigned location');
    }

    const existingEnrolment = await this.prisma.enrolment.findFirst({
      where: { tenantId, participantId, sessionId: dto.sessionId, locationId, deletedAt: null },
    });
    if (existingEnrolment) {
      throw new BadRequestException('Participant is already enrolled in this session');
    }

    const existingWaitlist = await this.prisma.waitlist.findFirst({
      where: { tenantId, participantId, sessionId: dto.sessionId, locationId, deletedAt: null },
    });
    if (existingWaitlist) {
      throw new BadRequestException('Participant is already on the waitlist for this session');
    }

    await this.assertNoOverlap(tenantId, participantId, dto.sessionId, {
      allowOverlap: options.allowOverlap,
      excludeEnrolmentId: previousEnrolmentId,
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const allocation = await this.allocator.allocate(tx, {
          tenantId,
          participantId,
          sessionId: dto.sessionId,
          locationId,
          paymentPlanType: dto.paymentPlanType,
          reEnrolledFromId: previousEnrolmentId,
          programId: previousEnrolment.programId ?? undefined,
        });

        if (allocation.outcome === 'ENROLLED') {
          return { status: 'ENROLLED', enrolment: allocation.enrolment };
        }
        return { status: 'WAITLISTED', waitlist: allocation.waitlist };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    return result;
  }

  // â”€â”€â”€ Find all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async findAll(tenantId: string, user: any, query: FindEnrolmentsDto) {
    const { sessionId, locationId, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId, deletedAt: null };

    if (sessionId) where.sessionId = sessionId;
    if (status)    where.status    = status;

    if (user?.role === UserRole.LOCATION_MANAGER && user.locationId) {
      where.locationId = user.locationId;
    } else if (locationId) {
      where.locationId = locationId;
    }

    const [items, total] = await Promise.all([
      this.prisma.enrolment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          participant: true,
          session:     true,
          location:    true,
          program:     { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.enrolment.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // â”€â”€â”€ Calculate fee (live preview for staff form) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Pure fee calculation â€” no side effects.
   * The right-hand "Live Fee Summary" panel calls this as the user fills in
   * location / program / term / join date / commitment length.
   *
   * Fee precedence (per term):
   *   1. Program.baseFeePerWeek Ã— session.totalWeeks  (when programId is set)
   *   2. SessionLocation.feeOverride
   *   3. Session.baseFee
   *
   * Total = per-term fee Ã— commitmentLength.
   * Kit fee is flagged but not yet priced (no rate-card model exists yet).
   */
  async calculateFee(tenantId: string, dto: CalculateFeeDto) {
    const session = await this.prisma.session.findFirst({
      where: { id: dto.sessionId, tenantId, deletedAt: null },
      include: {
        sessionLocations: {
          where: { locationId: dto.locationId },
          select: { feeOverride: true },
        },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.sessionLocations?.length) {
      throw new BadRequestException('Session is not offered at this location');
    }

    let perTermFee: Prisma.Decimal;
    let feeSource: string;

    if (dto.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: dto.programId, tenantId, deletedAt: null },
        select: { baseFeePerWeek: true, name: true, code: true },
      });
      if (!program) throw new NotFoundException('Program not found');

      if (program.baseFeePerWeek && session.totalWeeks) {
        perTermFee = (program.baseFeePerWeek as Prisma.Decimal).mul(session.totalWeeks);
        feeSource  = 'PROGRAM_WEEKLY_RATE';
      } else {
        perTermFee = (session.sessionLocations[0]?.feeOverride ?? session.baseFee) as Prisma.Decimal;
        feeSource  = session.sessionLocations[0]?.feeOverride ? 'LOCATION_OVERRIDE' : 'SESSION_BASE';
      }
    } else {
      perTermFee = (session.sessionLocations[0]?.feeOverride ?? session.baseFee) as Prisma.Decimal;
      feeSource  = session.sessionLocations[0]?.feeOverride ? 'LOCATION_OVERRIDE' : 'SESSION_BASE';
    }

    const commitmentLength = dto.commitmentLength ?? 1;
    const totalFee = perTermFee.mul(commitmentLength);

    return {
      perTermFee:       perTermFee.toFixed(2),
      totalFee:         totalFee.toFixed(2),
      kitFee:           '0.00',
      kitIncluded:      dto.includeKit ?? false,
      commitmentLength,
      feeSource,
      session: {
        id:         session.id,
        name:       session.name,
        totalWeeks: session.totalWeeks,
        startDate:  session.startDate,
        endDate:    session.endDate,
      },
      breakdown: {
        perTermFee:       perTermFee.toFixed(2),
        termsCommitted:   commitmentLength,
        kitFee:           '0.00',
        total:            totalFee.toFixed(2),
        note:             'Kit fee not yet priced â€” will be added when rate card is configured.',
      },
    };
  }

  // â”€â”€â”€ Available terms for staff registration form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Returns terms offered at the given location that are still open for enrolment.
   * A term is considered available when:
   *   - Its endDate has not yet passed.
   *   - Its status is neither CLOSED nor ARCHIVED.
   *   - It is linked to the location via session_locations.
   */
  async getAvailableTerms(tenantId: string, dto: GetAvailableTermsDto) {
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
      select: { id: true, name: true, capacity: true },
    });
    if (!location) throw new NotFoundException('Location not found');

    const now = new Date();

    const terms = await this.prisma.session.findMany({
      where: {
        tenantId,
        deletedAt: null,
        endDate: { gte: now },
        status: { notIn: [SessionStatus.CLOSED, SessionStatus.ARCHIVED] },
        sessionLocations: { some: { locationId: dto.locationId } },
      },
      orderBy: [{ seasonId: 'asc' }, { termNumber: 'asc' }, { startDate: 'asc' }],
      include: {
        sessionLocations: {
          where: { locationId: dto.locationId },
          select: { feeOverride: true },
        },
        season: { select: { id: true, name: true } },
      },
    });

    return terms.map((t) => ({
      id:           t.id,
      name:         t.name,
      startDate:    t.startDate,
      endDate:      t.endDate,
      status:       t.status,
      termNumber:   t.termNumber,
      totalWeeks:   t.totalWeeks,
      baseFee:      t.baseFee,
      feeOverride:  t.sessionLocations[0]?.feeOverride ?? null,
      season:       t.season,
    }));
  }

  // â”€â”€â”€ Staff register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Single-endpoint staff registration â€” wraps the entire "Register Student"
   * form submission shown in the admin UI:
   *
   *   1. Resolve or create participant (student).
   *   2. Resolve or create guardian (family).
   *   3. For each selected term:
   *      a. Validate the term is open and offered at the location.
   *      b. Allocate a seat via the allocator (enrolment or waitlist).
   *      c. If enrolled: stamp joinDate, create invoice, optionally record payment.
   *   4. Return per-term outcomes. Waitlisted terms include position + message.
   */
  async staffRegister(tenantId: string, user: any, dto: StaffRegisterDto) {
    // â”€â”€ Cross-field validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isNewStudent = !dto.participantId;
    if (isNewStudent) {
      const missing: string[] = [];
      if (!dto.firstNameEn)         missing.push('firstNameEn');
      if (!dto.lastNameEn)          missing.push('lastNameEn');
      if (!dto.dateOfBirth)         missing.push('dateOfBirth');
      if (!dto.gender)              missing.push('gender');
      if (!dto.guardianFullName)    missing.push('guardianFullName');
      if (!dto.guardianPhone)       missing.push('guardianPhone');
      if (!dto.guardianRelationship) missing.push('guardianRelationship');
      if (missing.length) {
        throw new BadRequestException(
          `When creating a new student, these fields are required: ${missing.join(', ')}`,
        );
      }
    }

    if (dto.recordPaymentNow && !dto.paymentMethod) {
      throw new BadRequestException('paymentMethod is required when recordPaymentNow is true');
    }

    // â”€â”€ Pre-fetch location (early 404) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    if (user?.role === UserRole.LOCATION_MANAGER && user.locationId !== dto.locationId) {
      throw new ForbiddenException('Location managers can only register students at their assigned location');
    }

    // â”€â”€ Validate program once â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let programBaseFeePerWeek: Prisma.Decimal | null = null;
    if (dto.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: dto.programId, tenantId, deletedAt: null },
        select: { baseFeePerWeek: true },
      });
      if (!program) throw new NotFoundException('Program not found');
      programBaseFeePerWeek = program.baseFeePerWeek as Prisma.Decimal | null;
    }

    // â”€â”€ Validate every term and pre-compute per-term fees â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Done outside the transaction for early, clean 400/404 responses.
    const now = new Date();

    type TermContext = { session: any; perTermFee: Prisma.Decimal };
    const termContexts = new Map<string, TermContext>();

    for (const termId of dto.termIds) {
      const session = await this.prisma.session.findFirst({
        where: { id: termId, tenantId, deletedAt: null },
        include: {
          sessionLocations: {
            where: { locationId: dto.locationId },
            select: { feeOverride: true },
          },
        },
      });
      if (!session) throw new NotFoundException(`Term ${termId} not found`);

      if (!session.sessionLocations?.length) {
        throw new BadRequestException(`Term "${session.name}" is not offered at the specified location`);
      }
      if (session.endDate < now) {
        throw new BadRequestException(`Term "${session.name}" has already ended and cannot accept new enrolments`);
      }
      if (
        session.status === SessionStatus.CLOSED ||
        session.status === SessionStatus.ARCHIVED
      ) {
        throw new BadRequestException(`Term "${session.name}" is closed and cannot accept new enrolments`);
      }

      let perTermFee: Prisma.Decimal;
      if (programBaseFeePerWeek && session.totalWeeks) {
        perTermFee = programBaseFeePerWeek.mul(session.totalWeeks);
      } else {
        perTermFee = (session.sessionLocations[0]?.feeOverride ?? session.baseFee) as Prisma.Decimal;
      }

      termContexts.set(termId, { session, perTermFee });
    }

    // â”€â”€ Transaction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const txResult = await this.prisma.$transaction(
      async (tx) => {
        // Step 1 â€” resolve or create participant (once for all terms)
        let participantId: string;

        if (dto.participantId) {
          const existing = await tx.participant.findFirst({
            where: { id: dto.participantId, tenantId, deletedAt: null },
            select: { id: true, locationId: true },
          });
          if (!existing) throw new NotFoundException('Participant not found');

          if (
            user?.role === UserRole.LOCATION_MANAGER &&
            existing.locationId !== user.locationId
          ) {
            throw new ForbiddenException('Location managers can only register participants from their location');
          }

          participantId = existing.id;
        } else {
          const homeLocationId = dto.primaryLocationId ?? dto.locationId;

          const homeLocation = await tx.location.findFirst({
            where: { id: homeLocationId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!homeLocation) throw new NotFoundException('Primary location not found');

          const seq      = await nextTenantSequence(tx, tenantId, 'participant');
          const uniqueId = generateUniqueId('P', seq);

          const participant = await tx.participant.create({
            data: {
              tenantId,
              locationId:  homeLocationId,
              uniqueId,
              firstNameEn: dto.firstNameEn!,
              lastNameEn:  dto.lastNameEn!,
              dateOfBirth: new Date(dto.dateOfBirth!),
              gender:      dto.gender!,
              status:      'INQUIRY' as any,
              phone:       dto.guardianPhone!,
              registrationSource: 'STAFF_REGISTERED' as any,
            },
          });

          await tx.guardian.create({
            data: {
              tenantId,
              participantId: participant.id,
              fullName:      dto.guardianFullName!,
              relationship:  dto.guardianRelationship ?? 'Parent',
              phone:         dto.guardianPhone!,
              email:         dto.guardianEmail ?? null,
            },
          });

          participantId = participant.id;
        }

        // Step 2 â€” allocate each term in sequence
        const joinDate = dto.joinDate ? new Date(dto.joinDate) : null;

        type TermResult = {
          termId:          string;
          termName:        string;
          outcome:         'ENROLLED' | 'WAITLISTED';
          enrolment?:      any;
          invoice?:        any;
          payment?:        any;
          waitlist?:       any;
          waitlistPosition?: number;
          message?:        string;
        };

        const termResults: TermResult[] = [];

        for (const [termId, { session, perTermFee }] of termContexts) {
          const alreadyEnrolled = await tx.enrolment.findFirst({
            where: {
              tenantId,
              participantId,
              sessionId:  termId,
              locationId: dto.locationId,
              deletedAt:  null,
            },
            select: { id: true },
          });
          if (alreadyEnrolled) {
            throw new ConflictException(
              `Participant is already enrolled in term "${session.name}" at this location`,
            );
          }

          const allocation = await this.allocator.allocate(tx, {
            tenantId,
            participantId,
            sessionId:       termId,
            locationId:      dto.locationId,
            paymentPlanType: PaymentPlanType.FULL,
            programId:       dto.programId,
          });

          if (allocation.outcome === 'ENROLLED') {
            let enrolment = allocation.enrolment!;

            enrolment = await tx.enrolment.update({
              where: { id: enrolment.id },
              data: {
                joinDate,
                commitmentLength: 1, // each term is an independent commitment
                includeKit:       dto.includeKit ?? false,
                totalFee:         perTermFee,
                balance:          perTermFee,
              },
            });

            const invSeq        = await nextTenantSequence(tx, tenantId, 'invoice');
            const invoiceNumber = `INV-${new Date().getFullYear()}-${invSeq.toString().padStart(6, '0')}`;
            const dueDate       = new Date();
            dueDate.setDate(dueDate.getDate() + 14);

            const invoice = await tx.invoice.create({
              data: {
                tenantId,
                enrolmentId:     enrolment.id,
                invoiceNumber,
                amount:          perTermFee,
                dueDate,
                status:          'PENDING' as any,
                paymentPlanType: 'FULL' as any,
              },
            });

            let payment: any = null;
            if (dto.recordPaymentNow) {
              payment = await tx.payment.create({
                data: {
                  tenantId,
                  enrolmentId:    enrolment.id,
                  invoiceId:      invoice.id,
                  recordedById:   user?.id ?? user?.sub,
                  gateway:        'OFFLINE' as any,
                  method:         dto.paymentMethod as any,
                  amount:         perTermFee,
                  status:         'PENDING_VERIFICATION' as any,
                  idempotencyKey: `staff-reg-${enrolment.id}-${Date.now()}`,
                  ...(dto.paymentReference ? { gatewayRef: dto.paymentReference } : {}),
                },
              });
            }

            termResults.push({ termId, termName: session.name, outcome: 'ENROLLED', enrolment, invoice, payment });
          } else {
            const waitlist = allocation.waitlist!;
            termResults.push({
              termId,
              termName:        session.name,
              outcome:         'WAITLISTED',
              waitlist,
              waitlistPosition: waitlist.position,
              message:
                `The program capacity for "${session.name}" has been reached. ` +
                `The participant has been added to the waitlist at position ${waitlist.position}.`,
            });
          }
        }

        return { participantId, termResults };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    const enrolled   = txResult.termResults.filter((r) => r.outcome === 'ENROLLED');
    const waitlisted = txResult.termResults.filter((r) => r.outcome === 'WAITLISTED');

    return {
      success: true,
      participantId: txResult.participantId,
      summary: {
        enrolled:   enrolled.length,
        waitlisted: waitlisted.length,
        ...(waitlisted.length > 0 && {
          waitlistMessage:
            'One or more terms have reached capacity. ' +
            'The participant has been added to the respective waitlist(s) and will be notified when a seat becomes available.',
        }),
      },
      results: txResult.termResults,
    };
  }
}
