import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { EnrolmentAllocatorService } from './enrolment-allocator.service.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { ReEnrolDto } from './dto/re-enrol.dto.js';
import { FindEnrolmentsDto } from './dto/find-enrolments.dto.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@Injectable()
export class EnrolmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocator: EnrolmentAllocatorService,
  ) {}

  /**
   * Plan F-18 — refuse a new enrolment when the participant already has
   * an *active* enrolment whose session date range overlaps with the
   * one they're trying to join.
   *
   * "Active" = ACTIVE | FEE_PENDING | DOCUMENTS_PENDING. WITHDRAWN /
   * COMPLETED / CANCELLED are ignored — past sessions don't block new
   * ones. WAITLISTED is also ignored (they don't have a confirmed seat).
   *
   * Set `allowOverlap=true` to skip the check. Callers should gate this
   * behind a SUPER_ADMIN / FINANCE_OFFICER role check.
   */
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
    if (!target) {
      // Caller should have already validated the session; if not, surface
      // a clean 404 so we don't leak this method's existence on bad IDs.
      throw new NotFoundException('Session not found');
    }

    const overlap = await this.prisma.enrolment.findFirst({
      where: {
        tenantId,
        participantId,
        deletedAt: null,
        ...(options.excludeEnrolmentId && { NOT: { id: options.excludeEnrolmentId } }),
        status: { in: ['ACTIVE', 'FEE_PENDING', 'DOCUMENTS_PENDING'] },
        session: {
          // Two ranges [a1,a2] and [b1,b2] overlap when a1 <= b2 AND a2 >= b1.
          startDate: { lte: target.endDate },
          endDate: { gte: target.startDate },
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

  async enrol(tenantId: string, user: any, dto: CreateEnrolmentDto, options: { allowOverlap?: boolean } = {}) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: dto.participantId, tenantId, deletedAt: null },
    });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId, deletedAt: null },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const session = await this.prisma.session.findFirst({
      where: { id: dto.sessionId, tenantId, deletedAt: null },
      include: {
        sessionLocations: {
          where: { locationId: dto.locationId },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!session.sessionLocations || session.sessionLocations.length === 0) {
      throw new BadRequestException('Session is not offered at the specified location');
    }

    // Role-based authorization check
    if (user?.role === UserRole.LOCATION_MANAGER) {
      if (user.locationId !== dto.locationId) {
        throw new ForbiddenException('Location managers can only enrol in their assigned location');
      }
      if (participant.locationId !== user.locationId) {
        throw new ForbiddenException('Location managers can only enrol participants belonging to their assigned location');
      }
    }

    // Check if participant is already enrolled or waitlisted
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
      throw new BadRequestException('Participant is already on the waitlist for this session at this location');
    }

    // Plan F-18 — refuse overlapping enrolments unless explicitly bypassed.
    await this.assertNoOverlap(tenantId, dto.participantId, dto.sessionId, {
      allowOverlap: options.allowOverlap,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Allocator handles capacity check + enrolment/waitlist creation under
      // a transaction-scoped advisory lock keyed by (sessionId, locationId),
      // so parallel calls cannot overbook the session.
      const allocation = await this.allocator.allocate(tx, {
        tenantId,
        participantId: dto.participantId,
        sessionId: dto.sessionId,
        locationId: dto.locationId,
        paymentPlanType: dto.paymentPlanType,
      });

      if (allocation.outcome === 'ENROLLED') {
        return { status: 'ENROLLED', enrolment: allocation.enrolment };
      }
      return { status: 'WAITLISTED', waitlist: allocation.waitlist };
    }, {
      // Concurrent staff-enrolments into the same (session, location) serialize
      // on the advisory lock inside the allocator. Default 5s tx timeout
      // would kill tail-end waiters under N>3 parallelism on Neon.
      timeout: 60000,
      maxWait: 60000,
    });

    return result;
  }

  async reEnrol(tenantId: string, user: any, previousEnrolmentId: string, dto: ReEnrolDto, options: { allowOverlap?: boolean } = {}) {
    const previousEnrolment = await this.prisma.enrolment.findFirst({
      where: { id: previousEnrolmentId, tenantId, deletedAt: null },
    });
    if (!previousEnrolment) {
      throw new NotFoundException('Previous enrolment not found');
    }

    const participantId = previousEnrolment.participantId;
    const locationId = previousEnrolment.locationId;

    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, tenantId, deletedAt: null },
    });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId, deletedAt: null },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const session = await this.prisma.session.findFirst({
      where: { id: dto.sessionId, tenantId, deletedAt: null },
      include: {
        sessionLocations: {
          where: { locationId },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!session.sessionLocations || session.sessionLocations.length === 0) {
      throw new BadRequestException('Session is not offered at the specified location');
    }

    // Role-based authorization check
    if (user?.role === UserRole.LOCATION_MANAGER) {
      if (user.locationId !== locationId) {
        throw new ForbiddenException('Location managers can only re-enrol in their assigned location');
      }
    }

    // Check if participant is already enrolled or waitlisted in the new session
    const existingEnrolment = await this.prisma.enrolment.findFirst({
      where: {
        tenantId,
        participantId,
        sessionId: dto.sessionId,
        locationId,
        deletedAt: null,
      },
    });
    if (existingEnrolment) {
      throw new BadRequestException('Participant is already enrolled in this session at this location');
    }

    const existingWaitlist = await this.prisma.waitlist.findFirst({
      where: {
        tenantId,
        participantId,
        sessionId: dto.sessionId,
        locationId,
        deletedAt: null,
      },
    });
    if (existingWaitlist) {
      throw new BadRequestException('Participant is already on the waitlist for this session at this location');
    }

    // Plan F-18 — refuse overlapping enrolments (excluding the
    // previous enrolment itself, which is being replaced).
    await this.assertNoOverlap(tenantId, participantId, dto.sessionId, {
      allowOverlap: options.allowOverlap,
      excludeEnrolmentId: previousEnrolmentId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Allocator handles capacity check + enrolment/waitlist creation under
      // a transaction-scoped advisory lock. reEnrolledFromId is threaded
      // through so the new enrolment row tracks its predecessor.
      const allocation = await this.allocator.allocate(tx, {
        tenantId,
        participantId,
        sessionId: dto.sessionId,
        locationId,
        paymentPlanType: dto.paymentPlanType,
        reEnrolledFromId: previousEnrolmentId,
      });

      if (allocation.outcome === 'ENROLLED') {
        return { status: 'ENROLLED', enrolment: allocation.enrolment };
      }
      return { status: 'WAITLISTED', waitlist: allocation.waitlist };
    }, {
      // Concurrent re-enrolments into the same (session, location) serialize
      // on the advisory lock inside the allocator. Default 5s tx timeout
      // would kill tail-end waiters under N>3 parallelism on Neon.
      timeout: 60000,
      maxWait: 60000,
    });

    return result;
  }

  async findAll(tenantId: string, user: any, query: FindEnrolmentsDto) {
    const { sessionId, locationId, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (sessionId) {
      where.sessionId = sessionId;
    }

    if (status) {
      where.status = status;
    }

    // Role-based filtering
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
          session: true,
          location: true,
        },
      }),
      this.prisma.enrolment.count({ where }),
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
}
