import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Default reminder schedule when a tenant has not customised
 * cm_payment_reminder_configs. Each entry is `daysUntilDue`:
 *   positive = upcoming reminder, 0 = due today, negative = overdue.
 *
 * The DB constraint allows only `daysBeforeDue >= 0` so overdue waves
 * (-3, -7) are only available via this code-default — tenants can't
 * disable them yet. We can lift that constraint later if needed.
 */
const DEFAULT_WAVES_UNTIL_DUE: number[] = [7, 1, 0, -3, -7];

/**
 * Plan F — payment reminder cron.
 *
 * Runs hourly. For each ACTIVE tenant:
 *   1. Resolve waves: union of code defaults + tenant config (db).
 *   2. For each wave, find invoices with dueDate = today + wave.
 *   3. enqueuePaymentReminder for each (idempotent per (invoice, wave)).
 *   4. Bump invoice.reminderSentCount (best-effort).
 *
 * Skips invoices with no `paymentLink` — a reminder without a payment
 * URL would frustrate the parent and bloat the notification log.
 */
@Injectable()
export class PaymentReminderProcessor {
  private readonly logger = new Logger(PaymentReminderProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'payment-reminder' })
  async run(): Promise<void> {
    if (!this.config.get<boolean>('app.paymentReminderEnabled')) {
      return;
    }

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const t of tenants) {
        try {
          await this.processTenant(t.id);
        } catch (err) {
          this.logger.error(
            `[run] tenant=${t.id} failed: ${(err as Error)?.message}`,
            (err as Error)?.stack,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[run] unexpected failure: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  private async processTenant(tenantId: string): Promise<void> {
    // Resolve waves for this tenant.
    //
    // DB rows store `daysBeforeDue` (≥0) which is the positive-direction
    // subset of daysUntilDue. We union these with the code defaults so
    // a tenant configuring "remind 3 days before" doesn't lose the
    // built-in overdue waves.
    const configs = await this.prisma.cmPaymentReminderConfig.findMany({
      where: { tenantId, enabled: true },
      select: { daysBeforeDue: true },
    });
    const customWaves = configs.map((c) => c.daysBeforeDue);
    const waves = configs.length
      ? Array.from(new Set([...customWaves, ...DEFAULT_WAVES_UNTIL_DUE.filter((w) => w < 0)]))
      : DEFAULT_WAVES_UNTIL_DUE;

    if (waves.length === 0) return;

    const today = startOfUtcDay(new Date());

    for (const wave of waves) {
      // wave = daysUntilDue. target dueDate = today + wave.
      const target = addDays(today, wave);

      const invoices = await this.prisma.invoice.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
          dueDate: {
            gte: target,
            lt: addDays(target, 1),
          },
        },
        include: {
          enrolment: {
            include: {
              session: { select: { name: true } },
              participant: {
                include: {
                  guardians: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (invoices.length === 0) continue;

      this.logger.log(
        `[processTenant] tenant=${tenantId} wave=t${wave} matched ${invoices.length} invoice(s)`,
      );

      for (const inv of invoices) {
        const guardian = inv.enrolment.participant.guardians[0];
        if (!guardian) continue;
        if (!inv.paymentLink) continue;

        await this.notifications.enqueuePaymentReminder({
          tenantId,
          invoiceId: inv.id,
          enrolmentId: inv.enrolmentId,
          participantId: inv.enrolment.participant.id,
          participantName: `${inv.enrolment.participant.firstNameEn} ${inv.enrolment.participant.lastNameEn}`,
          participantLang: inv.enrolment.participant.preferredLang ?? 'en',
          invoiceNumber: inv.invoiceNumber,
          amount: `SAR ${new Prisma.Decimal(inv.amount).toFixed(2)}`,
          dueDate: inv.dueDate.toISOString().slice(0, 10),
          daysUntilDue: wave,
          paymentUrl: inv.paymentLink,
          waveLabel: `t${wave}`,
          guardian: {
            fullName: guardian.fullName,
            phone: guardian.phone,
            email: guardian.email,
          },
        });

        await this.prisma.invoice
          .update({
            where: { id: inv.id },
            data: { reminderSentCount: { increment: 1 } },
          })
          .catch(() => undefined);
      }
    }
  }
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}
