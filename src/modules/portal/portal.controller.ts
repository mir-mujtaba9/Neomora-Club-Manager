import { Controller, Get, Post, Body, Param, NotFoundException, BadRequestException } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator.js';
import { ParticipantsService } from '../participants/participants.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { SessionStatus } from '@prisma/client';
import { CreatePortalRequestDto } from './dto/create-portal-request.dto.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';

import { NotificationsService } from '../notifications/notifications.service.js';

@Controller('portal')
export class PortalController {
  constructor(
    private readonly participantsService: ParticipantsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Post('registration/:tenantSlug/requests')
  async submitRegistrationRequest(
    @Param('tenantSlug') slug: string,
    @Body() dto: CreatePortalRequestDto,
  ) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Registration portal not found');

    const location = await this.prisma.location.findFirst({
      where: { id: dto.guardian.primaryLocationId, tenantId: tenant.id, deletedAt: null },
    });
    if (!location) throw new BadRequestException('Primary location not found or invalid');

    const result = await this.prisma.$transaction(async (tx) => {
      const uniqueIdNum = await nextTenantSequence(tx, tenant.id, 'participant');
      const uniqueId = `P-${uniqueIdNum.toString().padStart(5, '0')}`;

      const participant = await tx.participant.create({
        data: {
          tenantId: tenant.id,
          uniqueId,
          firstNameEn: dto.firstNameEn,
          lastNameEn: dto.lastNameEn,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          phone: dto.phone,
          status: 'INQUIRY' as any,
          registrationSource: 'PUBLIC_FORM' as any,
          locationId: dto.locationId || location.id,
        },
      });

      await tx.guardian.create({
        data: {
          tenantId: tenant.id,
          participantId: participant.id,
          fullName: dto.guardian.fullName,
          phone: dto.guardian.phone,
          email: dto.guardian.email || null,
          relationship: dto.guardian.relationship,
        },
      });

      if (dto.programId || (dto.termIds && dto.termIds.length > 0)) {
        const adminUser = await tx.user.findFirst({
          where: { tenantId: tenant.id },
        });
        
        if (adminUser) {
          let programName = 'Unknown Program';
          if (dto.programId) {
            const prog = await tx.program.findUnique({ where: { id: dto.programId } });
            if (prog) {
              programName = prog.name;
            }
          }

          let termNames = 'Unknown Terms';
          let locName = '';
          if (dto.termIds && dto.termIds.length > 0) {
            const terms = await tx.session.findMany({ 
              where: { id: { in: dto.termIds } },
              include: { sessionLocations: { include: { location: true } } }
            });
            if (terms.length > 0) {
              termNames = terms.map(t => t.name).join(', ');
              const termLoc = terms[0].sessionLocations?.[0]?.location?.name;
              if (termLoc) locName = ` at ${termLoc}`;
            }
          }

          const friendlyMessage = `PUBLIC REGISTRATION REQUEST: Participant requested to join program "${programName}"${locName} for terms: "${termNames}". Approve via Staff Registration.`;
          const systemData = `[SYSTEM_DATA: prog=${dto.programId || ''}, terms=${(dto.termIds || []).join(',')}]`;

          await tx.staffNote.create({
            data: {
              tenantId: tenant.id,
              participantId: participant.id,
              note: `${friendlyMessage} ${systemData}`,
              authorId: adminUser.id,
            }
          });
        }
      }

      return participant;
    });

    if (dto.guardian.email) {
      this.notifications.enqueueRegistrationOutcome({
        tenantId: tenant.id,
        participantId: result.id,
        outcome: 'INQUIRY',
        participantName: `${dto.firstNameEn} ${dto.lastNameEn}`,
        participantLang: 'en',
        uniqueId: result.uniqueId,
        sessionName: '',
        locationId: dto.locationId || location.id,
        locationName: location.name,
        guardian: {
          fullName: dto.guardian.fullName,
          phone: dto.guardian.phone,
          email: dto.guardian.email
        }
      }).catch(err => console.error('Failed to queue submission email', err));
    }

    return {
      success: true,
      referenceId: result.uniqueId,
      message: 'Registration request submitted successfully',
    };
  }

  @Public()
  @Get('registration/:tenantSlug/locations')
  async getRegistrationLocations(@Param('tenantSlug') slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    
    if (!tenant) throw new NotFoundException('Registration portal not found');

    return this.prisma.location.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        city: true,
        capacity: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  @Public()
  @Get('registration/:tenantSlug/programs')
  async getRegistrationPrograms(@Param('tenantSlug') slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    
    if (!tenant) throw new NotFoundException('Registration portal not found');

    return this.prisma.program.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  @Public()
  @Get('registration/:tenantSlug/locations/:locationId/seasons')
  async getRegistrationSeasons(
    @Param('tenantSlug') slug: string,
    @Param('locationId') locationId: string,
  ) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    
    if (!tenant) throw new NotFoundException('Registration portal not found');

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId: tenant.id, deletedAt: null },
    });

    if (!location) throw new NotFoundException('Location not found');

    const now = new Date();
    
    const terms = await this.prisma.session.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        endDate: { gte: now },
        status: { notIn: [SessionStatus.CLOSED, SessionStatus.ARCHIVED] },
        sessionLocations: { some: { locationId } },
      },
      orderBy: [{ seasonId: 'asc' }, { termNumber: 'asc' }, { startDate: 'asc' }],
      include: {
        sessionLocations: {
          where: { locationId },
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
      locationId,
    }));
  }

  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    return this.participantsService.getPortalByToken(token);
  }
}
