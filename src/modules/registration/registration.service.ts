import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { generateUniqueId } from '../../common/utils/unique-id.util.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';
import { EnrolmentAllocatorService } from '../enrolments/enrolment-allocator.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';
import { FormRegistrationDto } from './dto/form-registration.dto.js';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocator: EnrolmentAllocatorService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── GET /register/:slug ──────────────────────────────────────────────────

  /**
   * Returns everything the frontend registration form needs to render:
   *   - Location details
   *   - Open Terms (Sessions with status=OPEN at this location)
   *   - Programmes available at this location (location-specific + global)
   *     Each programme includes its cohort rules so the frontend can
   *     filter eligible programmes based on the child's birth year.
   */
  async getFormConfig(slug: string) {
    const location = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
      include: {
        tenant: { select: { id: true, name: true, slug: true, defaultLang: true } },
      },
    });

    if (!location || location.deletedAt || location.status !== 'active') {
      throw new NotFoundException(`Registration form for '${slug}' is not available`);
    }

    const now = new Date();

    // Open terms/sessions at this location within their enrolment window
    const sessionLocations = await this.prisma.sessionLocation.findMany({
      where: {
        locationId: location.id,
        session: {
          tenantId: location.tenantId,
          status: 'OPEN',
          deletedAt: null,
          OR: [{ enrolOpenAt: null }, { enrolOpenAt: { lte: now } }],
          AND: [{ OR: [{ enrolCloseAt: null }, { enrolCloseAt: { gte: now } }] }],
        },
      },
      include: {
        session: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            baseFee: true,
            totalWeeks: true,
            termNumber: true,
            seasonId: true,
            enrolOpenAt: true,
            enrolCloseAt: true,
            paymentPlans: {
              where: { deletedAt: null },
              select: {
                id: true,
                type: true,
                instalmentCount: true,
                instalmentAmount: true,
                dueDates: true,
              },
            },
          },
        },
      },
    });

    const sessions = sessionLocations.map((sl) => ({
      id:           sl.session.id,
      name:         sl.session.name,
      startDate:    sl.session.startDate,
      endDate:      sl.session.endDate,
      totalWeeks:   sl.session.totalWeeks,
      termNumber:   sl.session.termNumber,
      seasonId:     sl.session.seasonId,
      // Fee shown to the participant: location override first, then session base
      fee:          sl.feeOverride ?? sl.session.baseFee,
      enrolOpenAt:  sl.session.enrolOpenAt,
      enrolCloseAt: sl.session.enrolCloseAt,
      paymentPlans: sl.session.paymentPlans,
    }));

    // Programmes available at this location:
    //   - Programmes explicitly assigned to this location
    //   - Global programmes (locationId IS NULL)
    const programs = await this.prisma.program.findMany({
      where: {
        tenantId: location.tenantId,
        deletedAt: null,
        OR: [{ locationId: location.id }, { locationId: null }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        baseFeePerWeek: true,
        rules: {
          where: { deletedAt: null },
          orderBy: { minBirthYear: 'asc' },
          select: {
            id: true,
            label: true,
            minBirthYear: true,
            maxBirthYear: true,
            sessionsPerWeek: true,
            capacity: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      location: {
        id:               location.id,
        name:             location.name,
        city:             location.city,
        address:          location.address,
        phone:            location.phone,
        registrationSlug: location.registrationSlug,
        defaultLang:      location.defaultLang,
      },
      tenant:         location.tenant,
      sessions,
      programs,
      hasOpenSessions: sessions.length > 0,
      hasPrograms:     programs.length > 0,
    };
  }

  // ─── POST /register/:slug ─────────────────────────────────────────────────

  /**
   * Public form submission.
   *
   * Flow:
   *   1. Validate the location slug.
   *   2. If sessionId provided → validate it is OPEN and within enrolment window.
   *   3. If programId provided → validate it exists and is available at this location.
   *   4. Inside a transaction: create participant → guardian → allocate seat
   *      (enrolment or waitlist). Fee is calculated from programme weekly rate
   *      when available; otherwise falls back to session.baseFee.
   *   5. Fire notifications after commit (non-blocking).
   */
  async submitForm(slug: string, dto: FormRegistrationDto) {
    const location = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
    });

    if (!location || location.deletedAt || location.status !== 'active') {
      throw new NotFoundException(`Registration form for '${slug}' is not available`);
    }

    const tenantId = location.tenantId;

    const dob = new Date(dto.dateOfBirth);
    if (isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth');
    }

    // Validate session if provided
    let sessionName: string | null = null;
    if (dto.sessionId) {
      const now = new Date();
      const openSession = await this.prisma.session.findFirst({
        where: {
          id: dto.sessionId,
          tenantId,
          status: 'OPEN',
          deletedAt: null,
          OR: [{ enrolOpenAt: null }, { enrolOpenAt: { lte: now } }],
          AND: [{ OR: [{ enrolCloseAt: null }, { enrolCloseAt: { gte: now } }] }],
          // Must be offered at this location
          sessionLocations: { some: { locationId: location.id } },
        },
        select: { id: true, name: true },
      });
      if (!openSession) {
        throw new NotFoundException('The selected term is not available at this location');
      }
      sessionName = openSession.name;
    }

    // Validate programme if provided
    if (dto.programId) {
      if (!dto.sessionId) {
        throw new BadRequestException('sessionId is required when programId is provided');
      }
      const program = await this.prisma.program.findFirst({
        where: {
          id: dto.programId,
          tenantId,
          deletedAt: null,
          OR: [{ locationId: location.id }, { locationId: null }],
        },
        select: { id: true },
      });
      if (!program) {
        throw new NotFoundException('The selected programme is not available at this location');
      }
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const seq      = await nextTenantSequence(tx, tenantId, 'participant');
        const uniqueId = generateUniqueId('P', seq);

        const participant = await tx.participant.create({
          data: {
            tenantId,
            locationId:   location.id,
            uniqueId,
            firstNameEn:  dto.firstNameEn,
            firstNameAr:  dto.firstNameAr  ?? null,
            lastNameEn:   dto.lastNameEn,
            lastNameAr:   dto.lastNameAr   ?? null,
            dateOfBirth:  dob,
            gender:       dto.gender,
            nationality:  dto.nationality  ?? null,
            phone:        dto.phone,
            preferredLang: dto.preferredLang ?? 'en',
            status: 'INQUIRY',
          },
        });

        const guardian = await tx.guardian.create({
          data: {
            tenantId,
            participantId: participant.id,
            fullName:      dto.guardian.fullName,
            relationship:  dto.guardian.relationship,
            phone:         dto.guardian.phone,
            email:         dto.guardian.email ?? null,
          },
        });

        let enrolment: any   = null;
        let waitlistEntry: any = null;
        let enrolmentStatus: 'ENROLLED' | 'WAITLISTED' | 'NONE' = 'NONE';

        if (dto.sessionId) {
          const allocation = await this.allocator.allocate(tx, {
            tenantId,
            participantId: participant.id,
            sessionId:     dto.sessionId,
            locationId:    location.id,
            paymentPlanType: PaymentPlanType.FULL,
            programId:     dto.programId,
          });

          if (allocation.outcome === 'ENROLLED') {
            enrolment       = allocation.enrolment;
            enrolmentStatus = 'ENROLLED';
          } else {
            waitlistEntry   = allocation.waitlist;
            enrolmentStatus = 'WAITLISTED';
          }
        }

        return { participant, guardian, enrolment, waitlist: waitlistEntry, enrolmentStatus };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    void this.notifications.enqueueRegistrationOutcome({
      tenantId,
      participantId: result.participant.id,
      enrolmentId:   result.enrolment?.id ?? null,
      outcome:
        result.enrolmentStatus === 'NONE' ? 'INQUIRY' : result.enrolmentStatus,
      waitlistPosition: result.waitlist?.position,
      participantName:  `${result.participant.firstNameEn} ${result.participant.lastNameEn}`,
      participantLang:  result.participant.preferredLang,
      uniqueId:         result.participant.uniqueId,
      sessionName,
      locationId:   location.id,
      locationName: location.name,
      guardian: {
        fullName: result.guardian.fullName,
        phone:    result.guardian.phone,
        email:    result.guardian.email,
      },
    });

    return {
      success: true,
      participantId:    result.participant.id,
      uniqueId:         result.participant.uniqueId,
      enrolmentStatus:  result.enrolmentStatus,
      ...(result.enrolment    && { enrolmentId:      result.enrolment.id }),
      ...(result.waitlist     && { waitlistPosition: result.waitlist.position }),
      message: this.buildMessage(result.enrolmentStatus),
    };
  }

  private buildMessage(status: 'ENROLLED' | 'WAITLISTED' | 'NONE'): string {
    switch (status) {
      case 'ENROLLED':
        return 'Registration successful. You have been enrolled. Please complete your fee payment to confirm your spot.';
      case 'WAITLISTED':
        return 'Registration successful. The programme is currently full — you have been added to the waitlist and will be notified when a spot opens.';
      case 'NONE':
        return 'Registration successful. A staff member will be in touch to help you select a suitable programme.';
    }
  }
}
