import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  WaitlistOfferStatus,
  type Waitlist,
} from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EnrolmentAllocatorService } from '../enrolments/enrolment-allocator.service.js';
import { FindWaitlistDto } from './dto/find-waitlist.dto.js';

/**
 * How long a guardian has to respond to an offer before it auto-expires
 * and the seat is offered to the next person in line.
 *
 * 48h is a balance between (a) giving guardians time to coordinate and
 * (b) not starving the next person on the waitlist when capacity reopens
 * unexpectedly.
 */
const OFFER_TTL_HOURS = 48;

/**
 * Shape returned to staff endpoints after lifecycle operations. Keeps
 * controllers thin — no `any` leakage.
 */
export interface WaitlistLifecycleResult {
  status: 'OFFER_SENT' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED';
  waitlistId: string;
  enrolmentId?: string;
  /** Echoed back so frontends can show the deadline countdown. */
  offerExpiresAt?: Date;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly allocator: EnrolmentAllocatorService,
  ) {}

  // ─── Staff read-side ────────────────────────────────────────────────

  async getWaitlist(tenantId: string, user: any, query: FindWaitlistDto) {
    const { sessionId, locationId } = query;

    if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== locationId) {
      throw new ForbiddenException(
        'You do not have permission to view waitlist for this location',
      );
    }

    const entries = await this.prisma.waitlist.findMany({
      where: { tenantId, sessionId, locationId, deletedAt: null },
      orderBy: { position: 'asc' },
      include: { participant: true },
    });

    return entries.map((entry) => ({
      id: entry.id,
      position: entry.position,
      participant: entry.participant,
      offerStatus: entry.offerStatus,
      offerSentAt: entry.offerSentAt,
      offerExpiresAt: entry.offerExpiresAt,
      offerAttempts: entry.offerAttempts,
    }));
  }

  // ─── Staff write-side ───────────────────────────────────────────────

  /**
   * Manually send (or re-send) an offer to a waitlisted participant.
   * Used by staff when they know a seat will open soon, OR as a manual
   * override when the auto-promotion cron is disabled.
   *
   * Rotates the offer_token on every call so any in-flight previous
   * offer link becomes invalid. Returns the deadline so the dashboard
   * can show the countdown immediately.
   */
  async sendOffer(
    tenantId: string,
    waitlistId: string,
    user: any,
  ): Promise<WaitlistLifecycleResult> {
    const entry = await this.prisma.waitlist.findFirst({
      where: { id: waitlistId, tenantId, deletedAt: null },
    });
    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    this.assertStaffCanActOn(user, entry);

    if (entry.offerStatus !== WaitlistOfferStatus.PENDING) {
      // ACCEPTED/DECLINED/EXPIRED rows shouldn't be re-offered. Caller
      // should create a new waitlist entry if they want a fresh round.
      throw new ConflictException(
        `Cannot send offer — current status is ${entry.offerStatus}`,
      );
    }

    return this.issueOfferInternal(entry);
  }

  /**
   * Staff-side withdraw — soft-deletes the waitlist row and, if an offer
   * was outstanding, marks it DECLINED to free the slot for the next
   * person on the list.
   */
  async staffWithdraw(
    tenantId: string,
    waitlistId: string,
    user: any,
  ): Promise<WaitlistLifecycleResult> {
    const entry = await this.prisma.waitlist.findFirst({
      where: { id: waitlistId, tenantId, deletedAt: null },
    });
    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    this.assertStaffCanActOn(user, entry);

    await this.prisma.waitlist.update({
      where: { id: entry.id },
      data: {
        offerStatus: WaitlistOfferStatus.DECLINED,
        deletedAt: new Date(),
        offerToken: null,
        offerTokenExpiresAt: null,
      },
    });

    // Best-effort cascade: free the seat for whoever is next.
    void this.tryPromoteNext(entry.tenantId, entry.sessionId, entry.locationId);

    return { status: 'WITHDRAWN', waitlistId: entry.id };
  }

  // ─── Public (guardian token-auth) ───────────────────────────────────

  /**
   * Guardian accepts the offer. Creates an Enrolment via the allocator
   * (which re-checks capacity under the advisory lock — defence in depth
   * against double-allocation if two guardians race) and soft-deletes the
   * waitlist row.
   */
  async acceptOffer(
    token: string,
    paymentPlanType: PaymentPlanType,
  ): Promise<WaitlistLifecycleResult> {
    const entry = await this.resolveActiveOffer(token);

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Re-read inside the tx so we see fresh state under the lock.
        const fresh = await tx.waitlist.findUnique({
          where: { id: entry.id },
        });
        if (!fresh || fresh.deletedAt) {
          throw new ConflictException('Offer is no longer valid');
        }
        if (fresh.offerStatus !== WaitlistOfferStatus.PENDING) {
          throw new ConflictException(
            `Offer already ${fresh.offerStatus.toLowerCase()}`,
          );
        }
        if (fresh.offerExpiresAt && fresh.offerExpiresAt < new Date()) {
          throw new ConflictException('Offer has expired');
        }

        const allocation = await this.allocator.allocate(tx, {
          tenantId: fresh.tenantId,
          participantId: fresh.participantId,
          sessionId: fresh.sessionId,
          locationId: fresh.locationId,
          paymentPlanType,
        });

        if (allocation.outcome !== 'ENROLLED' || !allocation.enrolment) {
          // Capacity vanished between cron picking this row and the
          // guardian accepting — extremely rare but possible. Tell
          // the guardian, and the cron will pick them up again later.
          throw new ConflictException(
            'No seats currently available — please try again shortly',
          );
        }

        await tx.waitlist.update({
          where: { id: fresh.id },
          data: {
            offerStatus: WaitlistOfferStatus.ACCEPTED,
            deletedAt: new Date(),
            offerToken: null,
            offerTokenExpiresAt: null,
          },
        });

        return { enrolmentId: allocation.enrolment.id };
      },
      { timeout: 60_000, maxWait: 60_000 },
    );

    return {
      status: 'ACCEPTED',
      waitlistId: entry.id,
      enrolmentId: result.enrolmentId,
    };
  }

  /**
   * Guardian declines. Frees the seat for the next person on the list.
   * The seat is freed by `tryPromoteNext` rather than re-running the
   * allocator — they were never enrolled to begin with.
   */
  async declineOffer(token: string): Promise<WaitlistLifecycleResult> {
    const entry = await this.resolveActiveOffer(token);

    await this.prisma.waitlist.update({
      where: { id: entry.id },
      data: {
        offerStatus: WaitlistOfferStatus.DECLINED,
        deletedAt: new Date(),
        offerToken: null,
        offerTokenExpiresAt: null,
      },
    });

    void this.tryPromoteNext(entry.tenantId, entry.sessionId, entry.locationId);

    return { status: 'DECLINED', waitlistId: entry.id };
  }

  /**
   * Guardian removes themselves entirely. Same machinery as decline —
   * frees the seat for the next person and burns the token.
   */
  async guardianWithdraw(token: string): Promise<WaitlistLifecycleResult> {
    const entry = await this.resolveActiveOffer(token);

    await this.prisma.waitlist.update({
      where: { id: entry.id },
      data: {
        offerStatus: WaitlistOfferStatus.DECLINED,
        deletedAt: new Date(),
        offerToken: null,
        offerTokenExpiresAt: null,
      },
    });

    void this.tryPromoteNext(entry.tenantId, entry.sessionId, entry.locationId);

    return { status: 'WITHDRAWN', waitlistId: entry.id };
  }

  // ─── Internal: shared with WaitlistProcessor (cron) ────────────────

  /**
   * Mark all expired PENDING offers as EXPIRED. Returns the affected
   * (session, location) tuples so the caller can re-trigger promotion
   * for each.
   *
   * Called by `WaitlistProcessor.expireOffers` on a schedule and also
   * accessible to tests/admins for synchronous expiry.
   */
  async expireOutstandingOffers(): Promise<
    { tenantId: string; sessionId: string; locationId: string }[]
  > {
    const expired = await this.prisma.waitlist.findMany({
      where: {
        offerStatus: WaitlistOfferStatus.PENDING,
        offerSentAt: { not: null },
        offerExpiresAt: { lt: new Date() },
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        sessionId: true,
        locationId: true,
      },
    });

    if (expired.length === 0) return [];

    await this.prisma.waitlist.updateMany({
      where: { id: { in: expired.map((r) => r.id) } },
      data: {
        offerStatus: WaitlistOfferStatus.EXPIRED,
        // Keep deletedAt null — staff dashboards still want to see
        // expired rows for a few days. Tokens are cleared so the public
        // accept link 404s gracefully.
        offerToken: null,
        offerTokenExpiresAt: null,
      },
    });

    this.logger.log(
      `[expireOutstandingOffers] expired ${expired.length} offer(s)`,
    );

    // Dedupe (session, location) tuples — multiple expirations in the
    // same session+location only need ONE promotion pass.
    const tuples = new Map<
      string,
      { tenantId: string; sessionId: string; locationId: string }
    >();
    for (const row of expired) {
      tuples.set(
        `${row.tenantId}:${row.sessionId}:${row.locationId}`,
        {
          tenantId: row.tenantId,
          sessionId: row.sessionId,
          locationId: row.locationId,
        },
      );
    }
    return Array.from(tuples.values());
  }

  /**
   * For a given (tenant, session, location): if there's at least one
   * vacant seat AND no PENDING offer outstanding, send an offer to the
   * next active waitlist row by position. No-op otherwise.
   *
   * Safe to call concurrently — the per-row offer-token check inside
   * `issueOfferInternal` plus the partial unique index on dedupeKey in
   * notifications dedupe any double-fires.
   */
  async tryPromoteNext(
    tenantId: string,
    sessionId: string,
    locationId: string,
  ): Promise<WaitlistLifecycleResult | null> {
    // 1. Capacity check
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId, deletedAt: null },
      select: { capacity: true },
    });
    if (!location) return null;

    const enrolledCount = await this.prisma.enrolment.count({
      where: {
        tenantId,
        sessionId,
        locationId,
        deletedAt: null,
        status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
      },
    });
    if (enrolledCount >= location.capacity) {
      return null; // session full, no need to promote
    }

    // 2. Any outstanding offer already? Don't fan out duplicates.
    const outstanding = await this.prisma.waitlist.count({
      where: {
        tenantId,
        sessionId,
        locationId,
        deletedAt: null,
        offerStatus: WaitlistOfferStatus.PENDING,
        offerSentAt: { not: null },
        offerExpiresAt: { gt: new Date() },
      },
    });
    if (outstanding > 0) return null;

    // 3. Pick next candidate by position (smallest = first), preferring
    //    rows with FEWEST previous offer attempts so people who already
    //    declined-by-expiry don't keep blocking newer entries.
    const next = await this.prisma.waitlist.findFirst({
      where: {
        tenantId,
        sessionId,
        locationId,
        deletedAt: null,
        offerStatus: WaitlistOfferStatus.PENDING,
      },
      orderBy: [{ offerAttempts: 'asc' }, { position: 'asc' }],
    });
    if (!next) return null;

    return this.issueOfferInternal(next);
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  /**
   * Generate a fresh offer token, update the row, and enqueue the
   * notification. Caller is responsible for any RBAC checks.
   */
  private async issueOfferInternal(
    entry: Waitlist,
  ): Promise<WaitlistLifecycleResult> {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + OFFER_TTL_HOURS * 60 * 60 * 1000,
    );

    let updated: Waitlist;
    try {
      updated = await this.prisma.waitlist.update({
        where: { id: entry.id },
        data: {
          offerSentAt: now,
          offerExpiresAt: expiresAt,
          offerToken: token,
          offerTokenExpiresAt: expiresAt,
          offerAttempts: { increment: 1 },
          // Status stays PENDING — it only flips on accept/decline/expire.
        },
      });
    } catch (err) {
      // P2002 on the partial unique index would mean a token collision —
      // statistically impossible with 256-bit randomness but defensive.
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        this.logger.warn(
          `[issueOfferInternal] token collision on waitlist=${entry.id} — retrying`,
        );
        return this.issueOfferInternal(entry);
      }
      throw err;
    }

    // Fetch the surrounding context for the message body. One round-trip.
    const ctx = await this.prisma.waitlist.findUnique({
      where: { id: entry.id },
      include: {
        participant: {
          include: {
            guardians: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
        session: { select: { name: true } },
        location: { select: { name: true } },
      },
    });

    if (!ctx || !ctx.participant) {
      this.logger.error(
        `[issueOfferInternal] waitlist=${entry.id} missing participant after token write`,
      );
      return {
        status: 'OFFER_SENT',
        waitlistId: entry.id,
        offerExpiresAt: expiresAt,
      };
    }

    const guardian = ctx.participant.guardians[0];
    if (!guardian) {
      this.logger.warn(
        `[issueOfferInternal] waitlist=${entry.id} has no guardian — cannot notify`,
      );
      return {
        status: 'OFFER_SENT',
        waitlistId: updated.id,
        offerExpiresAt: expiresAt,
      };
    }

    const webBaseUrl =
      this.config.get<string>('app.webBaseUrl') || 'http://localhost:5173';
    const normalisedBase = webBaseUrl.replace(/\/+$/, '');
    const acceptUrl = `${normalisedBase}/waitlist/accept?token=${token}`;
    const declineUrl = `${normalisedBase}/waitlist/decline?token=${token}`;

    // Fire-and-forget: notifications never throw back to the caller.
    void this.notifications.enqueueWaitlistOffer({
      tenantId: entry.tenantId,
      waitlistId: entry.id,
      participantId: entry.participantId,
      participantName: `${ctx.participant.firstNameEn} ${ctx.participant.lastNameEn}`.trim(),
      participantLang: ctx.participant.preferredLang,
      sessionName: ctx.session?.name ?? 'your session',
      locationName: ctx.location?.name ?? 'your location',
      expiresAt,
      offerToken: token,
      acceptUrl,
      declineUrl,
      guardian: {
        fullName: guardian.fullName,
        phone: guardian.phone,
        email: guardian.email,
      },
    });

    return {
      status: 'OFFER_SENT',
      waitlistId: updated.id,
      offerExpiresAt: expiresAt,
    };
  }

  /**
   * Resolve a token → active waitlist row. Throws 404 for unknown tokens,
   * 409 for expired/terminal rows. Used by all three public guardian
   * endpoints (accept/decline/withdraw) so the error responses stay
   * consistent.
   */
  private async resolveActiveOffer(token: string): Promise<Waitlist> {
    if (!token || token.length < 16) {
      // Cheap up-front guard — full 32-byte hex = 64 chars.
      throw new NotFoundException('Invalid offer token');
    }

    const entry = await this.prisma.waitlist.findFirst({
      where: { offerToken: token, deletedAt: null },
    });
    if (!entry) {
      throw new NotFoundException('Offer not found or already used');
    }
    if (
      entry.offerTokenExpiresAt &&
      entry.offerTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Offer link has expired');
    }
    return entry;
  }

  /**
   * Centralised RBAC for staff-side waitlist actions. LOCATION_MANAGER
   * can only act on entries in their assigned location. SUPER_ADMIN
   * has full access. Other roles are rejected upstream by the guard.
   */
  private assertStaffCanActOn(user: any, entry: Waitlist): void {
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== entry.locationId
    ) {
      throw new ForbiddenException(
        'You do not have permission to act on this waitlist entry',
      );
    }
  }
}
