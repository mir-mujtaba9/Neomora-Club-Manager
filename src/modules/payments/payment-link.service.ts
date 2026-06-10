import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  InvoiceStatus,
  PaymentGateway,
  Prisma,
  type Guardian,
  type Invoice,
} from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentGatewayFactory } from './gateways/gateway.factory.js';

/**
 * Plan F — issue a checkout link for an invoice and notify the guardian.
 *
 * Flow:
 *   1. Load invoice + enrolment + participant + primary guardian + session.
 *   2. Refuse if invoice is already PAID or CANCELLED.
 *   3. Ensure the guardian has a long-lived portal token (mint one if not).
 *   4. Resolve the tenant's gateway strategy via PaymentGatewayFactory.
 *   5. strategy.createCheckoutLink → URL + optional expiry.
 *   6. Persist on Invoice.paymentLink / paymentLinkExpiresAt.
 *   7. Fire NotificationsService.enqueueFeeInvoice (idempotent per invoice).
 *
 * `issueLinkForInvoice` is the single public entry-point. It is safe
 * to call multiple times for the same invoice — the gateway re-issues
 * a fresh link and the notification dedupe-key suppresses duplicates.
 */
@Injectable()
export class PaymentLinkService {
  private readonly logger = new Logger(PaymentLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gateways: PaymentGatewayFactory,
    private readonly notifications: NotificationsService,
  ) {}

  async issueLinkForInvoice(
    tenantId: string,
    invoiceId: string,
  ): Promise<{
    invoice: Invoice;
    paymentUrl: string;
    paymentUrlExpiresAt: Date | null;
    gateway: PaymentGateway;
    notificationQueued: boolean;
  }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId, deletedAt: null },
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
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.status === InvoiceStatus.PAID) {
      throw new NotFoundException('Invoice already paid — no link required');
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new NotFoundException('Invoice cancelled — link unavailable');
    }

    const enrolment = invoice.enrolment;
    const participant = enrolment.participant;
    const guardian = participant.guardians[0];
    if (!guardian) {
      // Defensive — every participant must have ≥1 guardian per registration
      // flow, but a manually-deleted guardian could trigger this.
      throw new NotFoundException(
        'No primary guardian on file for this participant',
      );
    }

    // Ensure the guardian has a usable portal token. We use a long TTL
    // (1 year) because invoice links are referenced repeatedly over the
    // payment lifecycle and we don't want short-lived auth churn.
    const guardianWithToken = await this.ensurePortalToken(guardian);

    const strategy = await this.gateways.forTenant(tenantId);
    const webBaseUrl = this.config.get<string>('app.webBaseUrl', 'http://localhost:5173');

    const linkResult = await strategy.createCheckoutLink({
      tenantId,
      invoice,
      guardianPortalToken: guardianWithToken.portalToken!,
      webBaseUrl,
    });

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentLink: linkResult.url,
        paymentLinkExpiresAt: linkResult.expiresAt ?? null,
      },
    });

    // Fire-and-forget notification. enqueueFeeInvoice is dedupe-keyed
    // on the invoice ID so re-issuing the link doesn't double-message.
    await this.notifications.enqueueFeeInvoice({
      tenantId,
      invoiceId: invoice.id,
      enrolmentId: enrolment.id,
      participantId: participant.id,
      participantName: `${participant.firstNameEn} ${participant.lastNameEn}`,
      participantLang: participant.preferredLang ?? 'en',
      sessionName: enrolment.session?.name ?? '—',
      invoiceNumber: invoice.invoiceNumber,
      amount: this.formatAmount(invoice.amount),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      paymentUrl: linkResult.url,
      guardian: {
        fullName: guardian.fullName,
        phone: guardian.phone,
        email: guardian.email,
      },
    });

    return {
      invoice: updated,
      paymentUrl: linkResult.url,
      paymentUrlExpiresAt: linkResult.expiresAt ?? null,
      gateway: strategy.gateway,
      notificationQueued: true,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * If the guardian has no portalToken (or it has expired), mint a new
   * one with a 1-year TTL. Mutates the DB and returns the guardian
   * with the fresh token.
   */
  private async ensurePortalToken(guardian: Guardian): Promise<Guardian> {
    const hasToken = !!guardian.portalToken;
    const expired =
      !!guardian.portalTokenExpiresAt &&
      guardian.portalTokenExpiresAt.getTime() < Date.now();

    if (hasToken && !expired) return guardian;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    return this.prisma.guardian.update({
      where: { id: guardian.id },
      data: { portalToken: token, portalTokenExpiresAt: expiresAt },
    });
  }

  /**
   * Format an invoice amount for inclusion in a notification body.
   * Uses the default "SAR" prefix until a per-tenant currency field is
   * added (out of scope for Plan F).
   */
  private formatAmount(amount: Prisma.Decimal): string {
    return `SAR ${amount.toFixed(2)}`;
  }
}
