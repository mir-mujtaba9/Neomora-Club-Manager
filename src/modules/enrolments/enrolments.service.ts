import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { ReEnrolDto } from './dto/re-enrol.dto.js';
import { FindEnrolmentsDto } from './dto/find-enrolments.dto.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@Injectable()
export class EnrolmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async enrol(tenantId: string, user: any, dto: CreateEnrolmentDto) {
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

    const result = await this.prisma.$transaction(async (tx) => {
      // Calculate capacity
      const occupied = await tx.enrolment.count({
        where: {
          tenantId,
          sessionId: dto.sessionId,
          locationId: dto.locationId,
          deletedAt: null,
          status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
        },
      });

      if (occupied < location.capacity) {
        const feeOverride = session.sessionLocations[0]?.feeOverride;
        const totalFee = feeOverride !== undefined && feeOverride !== null ? feeOverride : session.baseFee;

        const enrolment = await tx.enrolment.create({
          data: {
            tenantId,
            participantId: dto.participantId,
            sessionId: dto.sessionId,
            locationId: dto.locationId,
            paymentPlanType: dto.paymentPlanType as any,
            totalFee: totalFee as any,
            paidAmount: 0 as any,
            balance: totalFee as any,
            status: 'FEE_PENDING',
          },
        });

        return { status: 'ENROLLED', enrolment };
      } else {
        const pos = await tx.waitlist.count({
          where: {
            tenantId,
            sessionId: dto.sessionId,
            locationId: dto.locationId,
            deletedAt: null,
          },
        }) + 1;

        const waitlistEntry = await tx.waitlist.create({
          data: {
            tenantId,
            participantId: dto.participantId,
            sessionId: dto.sessionId,
            locationId: dto.locationId,
            position: pos,
          },
        });

        return { status: 'WAITLISTED', waitlist: waitlistEntry };
      }
    });

    return result;
  }

  async reEnrol(tenantId: string, user: any, previousEnrolmentId: string, dto: ReEnrolDto) {
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

    const result = await this.prisma.$transaction(async (tx) => {
      // Calculate capacity
      const occupied = await tx.enrolment.count({
        where: {
          tenantId,
          sessionId: dto.sessionId,
          locationId,
          deletedAt: null,
          status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
        },
      });

      if (occupied < location.capacity) {
        const feeOverride = session.sessionLocations[0]?.feeOverride;
        const totalFee = feeOverride !== undefined && feeOverride !== null ? feeOverride : session.baseFee;

        const enrolment = await tx.enrolment.create({
          data: {
            tenantId,
            participantId,
            sessionId: dto.sessionId,
            locationId,
            paymentPlanType: dto.paymentPlanType as any,
            totalFee: totalFee as any,
            paidAmount: 0 as any,
            balance: totalFee as any,
            status: 'FEE_PENDING',
            reEnrolledFromId: previousEnrolmentId,
          },
        });

        return { status: 'ENROLLED', enrolment };
      } else {
        const pos = await tx.waitlist.count({
          where: {
            tenantId,
            sessionId: dto.sessionId,
            locationId,
            deletedAt: null,
          },
        }) + 1;

        const waitlistEntry = await tx.waitlist.create({
          data: {
            tenantId,
            participantId,
            sessionId: dto.sessionId,
            locationId,
            position: pos,
          },
        });

        return { status: 'WAITLISTED', waitlist: waitlistEntry };
      }
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
