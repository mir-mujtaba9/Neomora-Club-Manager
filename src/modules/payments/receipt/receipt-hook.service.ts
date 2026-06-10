import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Payment } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { PaymentsService } from '../payments.service.js';
import { ReceiptBuilderService } from './receipt-builder.service.js';

/**
 * Plan F — wires the PaymentsService onVerifiedHook to (a) generate
 * the PDF receipt, (b) fire PAYMENT_CONFIRM notification with the
 * download URL.
 *
 * Registered as a hook so the verify-payment endpoint never blocks
 * on PDF or notification work. Failures are logged but never bubble
 * up — the payment row is already COMPLETED so the financial outcome
 * is locked in, and ops can re-generate the PDF manually if needed.
 *
 * Implements OnModuleInit (instead of a constructor side-effect) so
 * the hook is registered exactly once during app boot.
 */
@Injectable()
export class ReceiptHookService implements OnModuleInit {
  private readonly logger = new Logger(ReceiptHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly builder: ReceiptBuilderService,
  ) {}

  onModuleInit(): void {
    this.payments.registerOnVerifiedHook((payment) => this.handle(payment));
  }

  private async handle(payment: Payment): Promise<void> {
    try {
      // 1. Build the PDF (sync, ~100 ms).
      const { storageKey } = await this.builder.build(payment.id);

      // 2. Persist the receiptKey so the dashboard can offer a download.
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { receiptKey: storageKey },
      });

      // 3. Resolve a download URL for the guardian notification body.
      let receiptUrl = '';
      try {
        const signed = await this.storage.getSignedUrl(storageKey, 60 * 60 * 24 * 7);
        receiptUrl = signed.url;
      } catch (err) {
        this.logger.warn(
          `[handle] could not sign receipt URL for payment=${payment.id}: ${(err as Error)?.message}`,
        );
      }

      // 4. Fire confirmation notification. Pull the participant + guardian
      // context we need for the template. Skip if anything is missing.
      const enrolment = await this.prisma.enrolment.findUnique({
        where: { id: payment.enrolmentId },
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
        },
      });
      const participant = enrolment?.participant;
      const guardian = participant?.guardians[0];
      if (!enrolment || !participant || !guardian) {
        this.logger.warn(
          `[handle] missing participant/guardian for payment=${payment.id}, skipping PAYMENT_CONFIRM`,
        );
        return;
      }

      await this.notifications.enqueuePaymentConfirm({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        enrolmentId: payment.enrolmentId,
        participantId: participant.id,
        participantName: `${participant.firstNameEn} ${participant.lastNameEn}`,
        participantLang: participant.preferredLang ?? 'en',
        amount: `SAR ${payment.amount.toFixed(2)}`,
        paymentMethod: payment.method,
        receiptUrl,
        guardian: {
          fullName: guardian.fullName,
          phone: guardian.phone,
          email: guardian.email,
        },
      });
    } catch (err) {
      this.logger.error(
        `[handle] receipt+notify pipeline failed for payment=${payment.id}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }
}
