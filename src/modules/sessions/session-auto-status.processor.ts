import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionStatus } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';

/**
 * Plan F-10 — auto-status processor.
 *
 * Runs every 15 minutes. Two transitions:
 *
 *   DRAFT  → OPEN   when enrolOpenAt  is set AND in the past
 *   OPEN   → CLOSED when enrolCloseAt is set AND in the past
 *
 * Why this and not a DB-side cron?
 *   • Keeps the transition reasoning in one place (TypeScript) where we
 *     can later add notification side-effects (e.g. "your session
 *     enrolment window has opened").
 *   • DB-side triggers are invisible from the dashboard logs.
 *
 * Idempotency: status comparisons in the WHERE clause ensure already-
 * advanced sessions are not touched. Safe to run as often as desired.
 *
 * Concurrency: NestJS Schedule serialises crons per name. If a previous
 * tick is still running (unlikely — query is single-digit ms), the next
 * one is silently skipped.
 */
@Injectable()
export class SessionAutoStatusProcessor {
  private readonly logger = new Logger(SessionAutoStatusProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'session-auto-status' })
  async run(): Promise<void> {
    if (!this.config.get<boolean>('app.sessionAutoStatusEnabled')) {
      return;
    }

    const now = new Date();

    try {
      const opened = await this.prisma.session.updateMany({
        where: {
          deletedAt: null,
          status: SessionStatus.DRAFT,
          enrolOpenAt: { not: null, lte: now },
        },
        data: { status: SessionStatus.OPEN },
      });
      if (opened.count > 0) {
        this.logger.log(`[run] DRAFT → OPEN: ${opened.count} session(s)`);
      }

      const closed = await this.prisma.session.updateMany({
        where: {
          deletedAt: null,
          status: SessionStatus.OPEN,
          enrolCloseAt: { not: null, lte: now },
        },
        data: { status: SessionStatus.CLOSED },
      });
      if (closed.count > 0) {
        this.logger.log(`[run] OPEN → CLOSED: ${closed.count} session(s)`);
      }
    } catch (err) {
      this.logger.error(
        `[run] failed: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }
}
