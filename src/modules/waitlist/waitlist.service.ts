import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { FindWaitlistDto } from './dto/find-waitlist.dto.js';

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  async getWaitlist(tenantId: string, user: any, query: FindWaitlistDto) {
    const { sessionId, locationId } = query;

    // RBAC: Location Manager can only view their own location's waitlist
    if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== locationId) {
      throw new ForbiddenException('You do not have permission to view waitlist for this location');
    }

    const waitlistEntries = await this.prisma.waitlist.findMany({
      where: {
        tenantId,
        sessionId,
        locationId,
        deletedAt: null,
      },
      orderBy: {
        position: 'asc',
      },
      include: {
        participant: true,
      },
    });

    return waitlistEntries.map((entry) => ({
      position: entry.position,
      participant: entry.participant,
      offerStatus: entry.offerStatus,
      offerExpiresAt: entry.offerExpiresAt,
    }));
  }
}
