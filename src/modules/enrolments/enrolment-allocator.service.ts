import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Enrolment, Waitlist } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import type { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';

export type AllocationOutcome = 'ENROLLED' | 'WAITLISTED';

export interface AllocateInput {
  tenantId: string;
  participantId: string;
  sessionId: string;
  locationId: string;
  paymentPlanType: PaymentPlanType;
  /** Set when this allocation is a re-enrolment; written to enrolment row. */
  reEnrolledFromId?: string;
  /**
   * Programme the participant is enrolling into.
   * When set the allocator:
   *   1. Resolves fee from Program.baseFeePerWeek × session.totalWeeks
   *      (falls back to session.baseFee when either value is absent).
   *   2. Checks capacity against the matching ProgramRule for the
   *      participant's birth year instead of the global location capacity.
   */
  programId?: string;
}

export interface AllocateResult {
  outcome: AllocationOutcome;
  enrolment?: Enrolment;
  waitlist?: Waitlist;
}

/**
 * Single source of truth for "give the participant a seat OR put them on the waitlist".
 *
 * Callers are responsible for:
 *   - Validating that the caller (user / public form) is allowed to act on
 *     this (tenant, session, location).
 *   - Rejecting duplicate registrations (same participant in same session+location).
 *   - Mapping the allocator's `outcome` / `enrolment` / `waitlist` to whatever
 *     response shape their controller already returns.
 *
 * The allocator itself validates:
 *   - Session exists and is not soft-deleted.
 *   - Session is offered at the given location (session_locations link).
 *   - Location exists and is not soft-deleted.
 *   - ProgramRule matches participant's birth year (when programId is supplied).
 */
@Injectable()
export class EnrolmentAllocatorService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(
    tx: Prisma.TransactionClient,
    input: AllocateInput,
  ): Promise<AllocateResult> {
    const {
      tenantId,
      participantId,
      sessionId,
      locationId,
      paymentPlanType,
      reEnrolledFromId,
      programId,
    } = input;

    // 1. Serialize parallel allocations for the same (session, location).
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${sessionId}), hashtext(${locationId}))
    `;

    // 2. Load session + the per-location fee override (if any).
    const session = await tx.session.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null },
      include: {
        sessionLocations: {
          where: { locationId },
          select: { feeOverride: true },
        },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.sessionLocations || session.sessionLocations.length === 0) {
      throw new BadRequestException('Session is not offered at the specified location');
    }

    // 3. Load location capacity (used when no programme rule applies).
    const location = await tx.location.findFirst({
      where: { id: locationId, tenantId, deletedAt: null },
      select: { capacity: true },
    });
    if (!location) throw new NotFoundException('Location not found');

    // 4. Resolve the enrolment fee.
    //    Priority: programme weekly rate → location fee override → session base fee.
    let totalFee: Prisma.Decimal =
      (session.sessionLocations[0]?.feeOverride ?? session.baseFee) as Prisma.Decimal;

    let programRule: { id: string; capacity: number } | null = null;

    if (programId) {
      // 4a. Fetch programme weekly rate for fee calculation.
      const program = await tx.program.findFirst({
        where: { id: programId, deletedAt: null },
        select: { baseFeePerWeek: true },
      });

      if (program?.baseFeePerWeek && session.totalWeeks) {
        totalFee = program.baseFeePerWeek.mul(session.totalWeeks) as Prisma.Decimal;
      }

      // 4b. Find the ProgramRule that covers this participant's birth year
      //     so we can use rule-level capacity instead of location capacity.
      const participant = await tx.participant.findFirst({
        where: { id: participantId, tenantId },
        select: { dateOfBirth: true },
      });

      if (participant?.dateOfBirth) {
        const birthYear = participant.dateOfBirth.getFullYear();
        programRule = await tx.programRule.findFirst({
          where: {
            programId,
            deletedAt: null,
            minBirthYear: { lte: birthYear },
            maxBirthYear: { gte: birthYear },
          },
          select: { id: true, capacity: true },
        });
      }
    }

    // 5. Count current occupants against the appropriate capacity.
    let occupied: number;
    let capacityLimit: number;

    if (programRule) {
      // Programme-rule capacity: count enrolments for this program+term combo.
      occupied = await tx.enrolment.count({
        where: {
          tenantId,
          sessionId,
          programId,
          deletedAt: null,
          status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
        },
      });
      capacityLimit = programRule.capacity;
    } else {
      // Legacy location capacity: total enrolments at this session+location.
      occupied = await tx.enrolment.count({
        where: {
          tenantId,
          sessionId,
          locationId,
          deletedAt: null,
          status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
        },
      });
      capacityLimit = location.capacity;
    }

    // 6a. Seat available → create enrolment at FEE_PENDING.
    if (occupied < capacityLimit) {
      const enrolment = await tx.enrolment.create({
        data: {
          tenantId,
          participantId,
          sessionId,
          locationId,
          paymentPlanType: paymentPlanType as Prisma.EnrolmentCreateInput['paymentPlanType'],
          totalFee,
          paidAmount: 0 as unknown as Prisma.Decimal,
          balance: totalFee,
          status: 'FEE_PENDING',
          ...(programId ? { programId } : {}),
          ...(reEnrolledFromId ? { reEnrolledFromId } : {}),
        },
      });
      return { outcome: 'ENROLLED', enrolment };
    }

    // 6b. At capacity → append to waitlist with MAX(position) + 1.
    const last = await tx.waitlist.findFirst({
      where: { tenantId, sessionId, locationId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = (last?.position ?? 0) + 1;

    const waitlist = await tx.waitlist.create({
      data: { tenantId, participantId, sessionId, locationId, position: nextPosition },
    });
    return { outcome: 'WAITLISTED', waitlist };
  }
}
