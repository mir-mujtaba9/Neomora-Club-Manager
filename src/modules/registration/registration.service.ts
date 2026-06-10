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
   * Returns the location details and all currently open sessions so the
   * frontend form can render a session picker dropdown.
   */
  async getFormConfig(slug: string) {
    const location = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            defaultLang: true,
          },
        },
      },
    });
 
    if (!location || location.deletedAt || location.status !== 'active') {
      throw new NotFoundException(
        `Registration form for '${slug}' is not available`,
      );
    }
 
    const now = new Date();
 
    // Only surface sessions that are OPEN and within their enrolment window
    const sessionLocations = await this.prisma.sessionLocation.findMany({
      where: {
        locationId: location.id,
        session: {
          tenantId: location.tenantId,
          status: 'OPEN',
          deletedAt: null,
          OR: [{ enrolOpenAt: null }, { enrolOpenAt: { lte: now } }],
          AND: [
            {
              OR: [
                { enrolCloseAt: null },
                { enrolCloseAt: { gte: now } },
              ],
            },
          ],
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
      id: sl.session.id,
      name: sl.session.name,
      startDate: sl.session.startDate,
      endDate: sl.session.endDate,
      // Fee shown to the participant: use location override if set
      fee: sl.feeOverride ?? sl.session.baseFee,
      enrolOpenAt: sl.session.enrolOpenAt,
      enrolCloseAt: sl.session.enrolCloseAt,
      paymentPlans: sl.session.paymentPlans,
    }));
 
    return {
      location: {
        id: location.id,
        name: location.name,
        city: location.city,
        address: location.address,
        phone: location.phone,
        registrationSlug: location.registrationSlug,
        defaultLang: location.defaultLang,
      },
      tenant: location.tenant,
      sessions,
      // Helper flag so the form knows whether to show the session picker
      hasOpenSessions: sessions.length > 0,
    };
  }
 
  // ─── POST /register/:slug ─────────────────────────────────────────────────
  /**
   * Public form submission.  The locationSlug comes from the URL, not the body.
   *
   * Behaviour:
   *  - If sessionId is provided → tries to enrol; falls back to waitlist when
   *    the session is at capacity (mirrors existing /participants/register logic).
   *  - If sessionId is omitted  → participant + guardian created at INQUIRY status,
   *    no enrolment record created.
   */
  async submitForm(slug: string, dto: FormRegistrationDto) {
    const location = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
    });
 
    if (!location || location.deletedAt || location.status !== 'active') {
      throw new NotFoundException(
        `Registration form for '${slug}' is not available`,
      );
    }
 
    const tenantId = location.tenantId;
 
    const dob = new Date(dto.dateOfBirth);
    if (isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth');
    }
 
    // Optional pre-check: for the PUBLIC registration form we only accept
    // sessions that are currently OPEN and within their enrolment window.
    // Doing this before the transaction gives a clean 404 without burning
    // a tenant sequence number on a doomed registration. We also use this
    // query to grab `name` for the post-commit notification body — saves
    // one round-trip.
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
          AND: [
            {
              OR: [
                { enrolCloseAt: null },
                { enrolCloseAt: { gte: now } },
              ],
            },
          ],
        },
        select: { id: true, name: true },
      });
      if (!openSession) {
        throw new NotFoundException(
          'The selected session is not available at this location',
        );
      }
      sessionName = openSession.name;
    }
 
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Reserve a tenant-scoped sequence value atomically. Replaces the
      //    previous `count + 1` pattern which could collide under concurrent
      //    registrations.
      const seq = await nextTenantSequence(tx, tenantId, 'participant');
      const uniqueId = generateUniqueId('P', seq);
 
      // 2. Create participant
      const participant = await tx.participant.create({
        data: {
          tenantId,
          locationId: location.id,
          uniqueId,
          firstNameEn: dto.firstNameEn,
          firstNameAr: dto.firstNameAr ?? null,
          lastNameEn: dto.lastNameEn,
          lastNameAr: dto.lastNameAr ?? null,
          dateOfBirth: dob,
          gender: dto.gender,
          nationality: dto.nationality ?? null,
          phone: dto.phone,
          preferredLang: dto.preferredLang ?? 'en',
          // Status starts at INQUIRY; advances once docs/fees are handled
          status: 'INQUIRY',
        },
      });
 
      // 3. Create guardian
      const guardian = await tx.guardian.create({
        data: {
          tenantId,
          participantId: participant.id,
          fullName: dto.guardian.fullName,
          relationship: dto.guardian.relationship,
          phone: dto.guardian.phone,
          email: dto.guardian.email ?? null,
        },
      });
 
      // 4. Optionally enrol / waitlist — delegated to the single source of
      //    truth so capacity races and position collisions are impossible.
      let enrolment: any = null;
      let waitlistEntry: any = null;
      let enrolmentStatus: 'ENROLLED' | 'WAITLISTED' | 'NONE' = 'NONE';
 
      if (dto.sessionId) {
        const allocation = await this.allocator.allocate(tx, {
          tenantId,
          participantId: participant.id,
          sessionId: dto.sessionId,
          locationId: location.id,
          paymentPlanType: PaymentPlanType.FULL,
        });
 
        if (allocation.outcome === 'ENROLLED') {
          enrolment = allocation.enrolment;
          enrolmentStatus = 'ENROLLED';
        } else {
          waitlistEntry = allocation.waitlist;
          enrolmentStatus = 'WAITLISTED';
        }
      }
 
      return {
        participant,
        guardian,
        enrolment,
        waitlist: waitlistEntry,
        enrolmentStatus,
      };
    }, {
      // Per-tx work itself is fast, but concurrent registrations into the
      // same (session, location) serialize on the advisory lock inside the
      // allocator. With N parallel waiters + Neon WebSocket latency the
      // tail-end transactions can sit on the lock past the default 5s
      // timeout. 60s gives ample headroom without holding connections forever.
      timeout: 60000,
      maxWait: 60000,
    });
 
    // Fire confirmation + staff alerts AFTER commit. Calling this inside
    // the transaction would (a) hold the tx open during channel I/O and
    // (b) leak notifications if the tx rolls back. The service is fire-and-
    // forget — it never throws back to us, so a notification problem can
    // never break a registration.
    void this.notifications.enqueueRegistrationOutcome({
      tenantId,
      participantId: result.participant.id,
      enrolmentId: result.enrolment?.id ?? null,
      outcome:
        result.enrolmentStatus === 'NONE' ? 'INQUIRY' : result.enrolmentStatus,
      waitlistPosition: result.waitlist?.position,
      participantName: `${result.participant.firstNameEn} ${result.participant.lastNameEn}`,
      participantLang: result.participant.preferredLang,
      uniqueId: result.participant.uniqueId,
      sessionName,
      locationId: location.id,
      locationName: location.name,
      guardian: {
        fullName: result.guardian.fullName,
        phone: result.guardian.phone,
        email: result.guardian.email,
      },
    });
 
    return {
      success: true,
      participantId: result.participant.id,
      uniqueId: result.participant.uniqueId,
      enrolmentStatus: result.enrolmentStatus,
      ...(result.enrolment && { enrolmentId: result.enrolment.id }),
      ...(result.waitlist && {
        waitlistPosition: result.waitlist.position,
      }),
      message: this.buildMessage(result.enrolmentStatus),
    };
  }
 
  private buildMessage(
    status: 'ENROLLED' | 'WAITLISTED' | 'NONE',
  ): string {
    switch (status) {
      case 'ENROLLED':
        return 'Registration successful. You have been enrolled in the session. Please complete your fee payment to confirm your spot.';
      case 'WAITLISTED':
        return 'Registration successful. The session is currently full — you have been added to the waitlist and will be notified when a spot opens.';
      case 'NONE':
        return 'Registration successful. A staff member will be in touch to help you select a suitable session.';
    }
  }
}