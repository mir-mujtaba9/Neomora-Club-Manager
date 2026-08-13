import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { EnrolmentAllocatorService } from './enrolment-allocator.service.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { ReEnrolDto } from './dto/re-enrol.dto.js';
import { FindEnrolmentsDto } from './dto/find-enrolments.dto.js';
import { CalculateFeeDto } from './dto/calculate-fee.dto.js';
import { StaffRegisterDto } from './dto/staff-register.dto.js';
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

  // ─── Overlap guard ────────────────────────────────────────────────────────

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

  // ─── Enrol ────────────────────────────────────────────────────────────────

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

  // ─── Re-enrol ─────────────────────────────────────────────────────────────

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

  // ─── Find all ─────────────────────────────────────────────────────────────

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

  // ─── Calculate fee (live preview for staff form) ──────────────────────────

  /**
   * Pure fee calculation — no side effects.
   * The right-hand "Live Fee Summary" panel calls this as the user fills in
   * location / program / term / join date / commitment length.
   *
   * Fee precedence (per term):
   *   1. Program.baseFeePerWeek × session.totalWeeks  (when programId is set)
   *   2. SessionLocation.feeOverride
   *   3. Session.baseFee
   *
   * Total = per-term fee × commitmentLength.
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
        note:             'Kit fee not yet priced — will be added when rate card is configured.',
      },
    };
  }

  // ─── Staff register ───────────────────────────────────────────────────────

  /**
   * Single-endpoint staff registration — wraps the entire "Register Student"
   * form submission shown in the admin UI:
   *
   *   1. Resolve or create participant (student).
   *   2. Resolve or create guardian (family).
   *   3. Allocate a seat via the allocator (enrolment or waitlist).
   *   4. Stamp joinDate, commitmentLength, includeKit on the enrolment.
   *   5. Create an invoice for the total fee.
   *   6. Optionally record a payment (goes to PENDING_VERIFICATION for finance sign-off).
   */
  async staffRegister(tenantId: string, user: any, dto: StaffRegisterDto) {
    // ── Validation ────────────────────────────────────────────────────────
    const isNewStudent = !dto.participantId;
    if (isNewStudent) {
      const missingFields: string[] = [];
      if (!dto.firstNameEn) missingFields.push('firstNameEn');
      if (!dto.lastNameEn)  missingFields.push('lastNameEn');
      if (!dto.dateOfBirth) missingFields.push('dateOfBirth');
      if (!dto.gender)      missingFields.push('gender');
      if (!dto.guardianFullName) missingFields.push('guardianFullName');
      if (!dto.guardianPhone)    missingFields.push('guardianPhone');
      if (!dto.guardianRelationship) missingFields.push('guardianRelationship');
      if (missingFields.length) {
        throw new BadRequestException(
          `When creating a new student, these fields are required: ${missingFields.join(', ')}`,
        );
      }
    }

    if (dto.recordPaymentNow && !dto.paymentMethod) {
      throw new BadRequestException('paymentMethod is required when recordPaymentNow is true');
    }

    // ── Pre-fetch session + location (outside tx for early 404s) ──────────
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
      throw new BadRequestException('Session is not offered at the specified location');
    }

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    // ── Location-manager scope guard ──────────────────────────────────────
    if (user?.role === UserRole.LOCATION_MANAGER && user.locationId !== dto.locationId) {
      throw new ForbiddenException('Location managers can only register students at their assigned location');
    }

    // ── Validate program ──────────────────────────────────────────────────
    let programBaseFeePerWeek: Prisma.Decimal | null = null;
    if (dto.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: dto.programId, tenantId, deletedAt: null },
        select: { baseFeePerWeek: true },
      });
      if (!program) throw new NotFoundException('Program not found');
      programBaseFeePerWeek = program.baseFeePerWeek as Prisma.Decimal | null;
    }

    // ── Pre-compute fee (mirrors calculateFee logic) ──────────────────────
    let perTermFee: Prisma.Decimal;
    if (programBaseFeePerWeek && session.totalWeeks) {
      perTermFee = programBaseFeePerWeek.mul(session.totalWeeks);
    } else {
      perTermFee = (session.sessionLocations[0]?.feeOverride ?? session.baseFee) as Prisma.Decimal;
    }
    const commitmentLength = dto.commitmentLength ?? 1;
    const totalFee = perTermFee.mul(commitmentLength);

    // ── Transaction ───────────────────────────────────────────────────────
    const result = await this.prisma.$transaction(
      async (tx) => {
        let participantId: string;

        if (dto.participantId) {
          // Use existing participant — just verify it belongs to this tenant
          const existing = await tx.participant.findFirst({
            where: { id: dto.participantId, tenantId, deletedAt: null },
            select: { id: true, locationId: true },
          });
          if (!existing) throw new NotFoundException('Participant not found');

          if (
            user?.role === UserRole.LOCATION_MANAGER &&
            existing.locationId !== user.locationId
          ) {
            throw new ForbiddenException(
              'Location managers can only register participants from their location',
            );
          }

          participantId = existing.id;
        } else {
          // Create new participant
          const homeLocationId = dto.primaryLocationId ?? dto.locationId;

          const homeLocation = await tx.location.findFirst({
            where: { id: homeLocationId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!homeLocation) throw new NotFoundException('Primary location not found');

          const seq      = await nextTenantSequence(tx, tenantId, 'participant');
          const uniqueId = generateUniqueId('P', seq);
          const dob      = new Date(dto.dateOfBirth!);

          const participant = await tx.participant.create({
            data: {
              tenantId,
              locationId:  homeLocationId,
              uniqueId,
              firstNameEn: dto.firstNameEn!,
              lastNameEn:  dto.lastNameEn!,
              dateOfBirth: dob,
              gender:      dto.gender!,
              status:      'INQUIRY' as any,
              phone:       dto.guardianPhone!,
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

        // Duplicate-enrolment guard
        const alreadyEnrolled = await tx.enrolment.findFirst({
          where: {
            tenantId,
            participantId,
            sessionId: dto.sessionId,
            locationId: dto.locationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (alreadyEnrolled) {
          throw new ConflictException(
            'This participant is already enrolled in this term at this location',
          );
        }

        // Allocate seat
        const allocation = await this.allocator.allocate(tx, {
          tenantId,
          participantId,
          sessionId:       dto.sessionId,
          locationId:      dto.locationId,
          paymentPlanType: PaymentPlanType.FULL,
          programId:       dto.programId,
        });

        let enrolment: any   = null;
        let waitlistEntry: any = null;

        if (allocation.outcome === 'ENROLLED') {
          enrolment = allocation.enrolment;

          // Stamp the extra registration fields onto the enrolment
          const joinDate = dto.joinDate ? new Date(dto.joinDate) : null;
          enrolment = await tx.enrolment.update({
            where: { id: enrolment.id },
            data: {
              joinDate:         joinDate,
              commitmentLength: commitmentLength,
              includeKit:       dto.includeKit ?? false,
              // Overwrite the fee with the commitment-adjusted total
              totalFee:  totalFee,
              balance:   totalFee,
            },
          });
        } else {
          waitlistEntry = allocation.waitlist;
        }

        // Create invoice (only for enrolled, not waitlisted)
        let invoice: any = null;
        if (enrolment) {
          const invSeq    = await nextTenantSequence(tx, tenantId, 'invoice');
          const year      = new Date().getFullYear();
          const invoiceNumber = `INV-${year}-${invSeq.toString().padStart(6, '0')}`;
          const dueDate   = new Date();
          dueDate.setDate(dueDate.getDate() + 14); // 14-day payment window

          invoice = await tx.invoice.create({
            data: {
              tenantId,
              enrolmentId:    enrolment.id,
              invoiceNumber,
              amount:         totalFee,
              dueDate,
              status:         'PENDING' as any,
              paymentPlanType: 'FULL' as any,
            },
          });
        }

        // Optionally record payment at registration
        let payment: any = null;
        if (dto.recordPaymentNow && enrolment && invoice) {
          const idempotencyKey = `staff-reg-${enrolment.id}-${Date.now()}`;
          payment = await tx.payment.create({
            data: {
              tenantId,
              enrolmentId:    enrolment.id,
              invoiceId:      invoice.id,
              recordedById:   user?.id ?? user?.sub,
              gateway:        'OFFLINE' as any,
              method:         dto.paymentMethod as any,
              amount:         totalFee,
              status:         'PENDING_VERIFICATION' as any,
              idempotencyKey,
              ...(dto.paymentReference ? { gatewayRef: dto.paymentReference } : {}),
            },
          });
        }

        return { participantId, enrolment, waitlist: waitlistEntry, invoice, payment };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    return {
      success:   true,
      outcome:   result.enrolment ? 'ENROLLED' : 'WAITLISTED',
      participantId: result.participantId,
      ...(result.enrolment    && { enrolment:  result.enrolment }),
      ...(result.waitlist     && { waitlist:   result.waitlist }),
      ...(result.invoice      && { invoice:    result.invoice }),
      ...(result.payment      && { payment:    result.payment }),
      fee: {
        perTermFee:       perTermFee.toFixed(2),
        totalFee:         totalFee.toFixed(2),
        commitmentLength,
      },
    };
  }
}
