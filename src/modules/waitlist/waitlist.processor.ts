import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WaitlistOfferStatus } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { WaitlistService } from './waitlist.service.js';

/**
 * Background processor for the waitlist lifecycle.
 *
 * Two jobs run on independent schedules:
 *  1. `expireOffers` — flips PENDING offers past their deadline to
 *     EXPIRED, then re-runs promotion for each affected (session,
 *     location) tuple.
 *  2. `promoteVacancies` — scans every (session, location) with active
 *     waitlist rows and offers seats to the next person whenever a
 *     vacancy is detected.
 *
 * Both jobs are guarded by `app.waitlistProcessorEnabled`. Off by
 * default so smoke tests and short-lived dev servers don't surprise-
 * dispatch notifications.
 *
 * Concurrency: NestJS Schedule does NOT re-enter a cron while a
 * previous run is in flight, so we don't need explicit locks. If the
 * promotion query takes longer than the cron interval (it shouldn't —
 * single-digit ms on Neon), the next tick is silently skipped.
 */
@Injectable()
export class WaitlistProcessor {
  private readonly logger = new Logger(WaitlistProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly waitlist: WaitlistService,
  ) {}

  /**
   * Mark all PENDING offers past their deadline as EXPIRED, then
   * promote the next person on the waitlist for each affected slot.
   *
   * 5-minute cadence matches the human-perceptible "did this expire?"
   * window — guardians won't notice a 2-min vs 5-min delay, and we
   * keep wakeups cheap.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'waitlist-expire-offers' })
  async expireOffers(): Promise<void> {
    if (!this.config.get<boolean>('app.waitlistProcessorEnabled')) {
      return;
    }

    try {
      const tuples = await this.waitlist.expireOutstandingOffers();
      if (tuples.length === 0) {
        this.logger.debug('[expireOffers] no offers to expire');
        return;
      }
      this.logger.log(
        `[expireOffers] expired ${tuples.length} offer(s) — promoting next`,
      );
      for (const t of tuples) {
        // Per-tuple try/catch so one bad (session, location) doesn't
        // starve the others.
        try {
          await this.waitlist.tryPromoteNext(
            t.tenantId,
            t.sessionId,
            t.locationId,
          );
        } catch (err) {
          this.logger.error(
            `[expireOffers] promote failed for ${t.sessionId}:${t.locationId}: ${(err as Error)?.message}`,
            (err as Error)?.stack,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[expireOffers] unexpected failure: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * Scan (tenant, session, location) tuples that currently have active
   * waitlist rows AND no outstanding live offer, and try to promote one
   * each tick. Cheap idle case: empty groupBy returns zero rows.
   *
   * 30-second cadence: fast enough to feel near-real-time when a seat
   * opens (cancellation, withdrawal, refund-induced WITHDRAWN), slow
   * enough that we don't hammer Postgres in steady state.
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'waitlist-promote' })
  async promoteVacancies(): Promise<void> {
    if (!this.config.get<boolean>('app.waitlistProcessorEnabled')) {
      return;
    }

    try {
      // Distinct (tenant, session, location) tuples that currently have
      // ANY active PENDING waitlist row without a live outstanding offer.
      // groupBy collapses dupes server-side so the worst case scales
      // with N(sessions × locations) not N(waitlist rows).
      const distinct = await this.prisma.waitlist.groupBy({
        by: ['tenantId', 'sessionId', 'locationId'],
        where: {
          deletedAt: null,
          offerStatus: WaitlistOfferStatus.PENDING,
          OR: [
            { offerSentAt: null },
            // Allow re-offering rows whose previous offer expired but
            // expireOffers hasn't ticked yet — tryPromoteNext re-checks
            // for outstanding offers so we won't double-fire.
            { offerExpiresAt: { lt: new Date() } },
          ],
        },
      });

      if (distinct.length === 0) {
        this.logger.debug('[promoteVacancies] nothing to promote');
        return;
      }

      this.logger.debug(
        `[promoteVacancies] scanning ${distinct.length} (session, location) tuple(s)`,
      );

      for (const t of distinct) {
        try {
          const result = await this.waitlist.tryPromoteNext(
            t.tenantId,
            t.sessionId,
            t.locationId,
          );
          if (result) {
            this.logger.log(
              `[promoteVacancies] sent offer for waitlist=${result.waitlistId} (session=${t.sessionId}, location=${t.locationId})`,
            );
          }
        } catch (err) {
          this.logger.error(
            `[promoteVacancies] tryPromoteNext failed for ${t.sessionId}:${t.locationId}: ${(err as Error)?.message}`,
            (err as Error)?.stack,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[promoteVacancies] unexpected failure: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }
}
