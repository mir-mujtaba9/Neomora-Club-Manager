import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@Injectable()
export class FamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search guardians by name, phone, or email across the tenant.
   * Guardians sharing the same phone number are grouped into one "family" unit,
   * since the same parent registers multiple siblings with identical contact info.
   *
   * Returns up to 10 family groups, each with their linked participants so the
   * staff UI can show "select an existing student" immediately after finding a match.
   */
  async search(tenantId: string, user: any, q: string) {
    const trimmed = q.trim();

    const guardians = await this.prisma.guardian.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { fullName:     { contains: trimmed, mode: 'insensitive' } },
          { phone:        { contains: trimmed } },
          { email:        { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: {
        participant: {
          select: {
            id:          true,
            uniqueId:    true,
            firstNameEn: true,
            lastNameEn:  true,
            dateOfBirth: true,
            gender:      true,
            status:      true,
            locationId:  true,
            location:    { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Location-manager scope: hide participants outside their location
    const visibleGuardians =
      user?.role === UserRole.LOCATION_MANAGER && user.locationId
        ? guardians.filter((g) => g.participant.locationId === user.locationId)
        : guardians;

    // Group by phone — same phone = same family
    const familyMap = new Map<
      string,
      { guardian: object; participants: object[] }
    >();

    for (const g of visibleGuardians) {
      const key = g.phone;
      if (!familyMap.has(key)) {
        familyMap.set(key, {
          guardian: {
            id:           g.id,
            fullName:     g.fullName,
            phone:        g.phone,
            email:        g.email,
            relationship: g.relationship,
          },
          participants: [],
        });
      }
      familyMap.get(key)!.participants.push(g.participant);
    }

    return Array.from(familyMap.values()).slice(0, 10);
  }
}
