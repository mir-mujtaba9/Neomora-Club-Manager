import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  EnrolmentStatus,
  ParticipantStatus,
  Prisma,
  type Payment,
} from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';

/**
 * Plan F-11 — auto-promotion service.
 *
 * Centralises the rule:
 *   FEE_PENDING → ACTIVE when balance ≤ tenant.balanceThreshold
 *                  AND all required documents are verified.
 *
 * Two entry points:
 *
 *   1. As a payment-verified hook (`onModuleInit` registers it on
 *      PaymentsService). Runs after every COMPLETED payment to flip
 *      the enrolment + participant once the threshold is crossed.
 *
 *   2. As a public helper (`tryPromote`) callable by the documents
 *      service when the last required document is verified — so an
 *      already-paid participant gets promoted the moment their docs
 *      complete.
 *
 * The "all documents verified" check is intentionally lenient for now:
 * if the participant has ANY verified document of each required type
 * configured for the tenant, it counts as verified. Until a
 * tenant-level "required document types" config exists, we just
 * check that at least one document is VERIFIED — matching the
 * existing DocumentsService promotion logic.
 *
 * Promotion is best-effort:
 *   • Wrapped in a tx so participant + enrolment statuses move together
 *   • Failures are logged but never thrown to the hook caller
 *   • Idempotent — running on an already-ACTIVE participant is a no-op
 */
@Injectable()
export class AutoPromotionService implements OnModuleInit {
  private readonly logger = new Logger(AutoPromotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.payments.registerOnVerifiedHook((payment) =>
      this.handlePaymentVerified(payment),
    );
  }

  private async handlePaymentVerified(payment: Payment): Promise<void> {
    try {
      await this.tryPromote(payment.tenantId, payment.enrolmentId);
    } catch (err) {
      this.logger.error(
        `[handlePaymentVerified] enrolment=${payment.enrolmentId} failed: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * Attempt to promote a single enrolment. Public so the documents
   * service can call it after marking the final document VERIFIED.
   *
   * Returns the promotion outcome for logging / audit purposes.
   */
  async tryPromote(
    tenantId: string,
    enrolmentId: string,
  ): Promise<{ promoted: boolean; reason: string }> {
    const enrolment = await this.prisma.enrolment.findFirst({
      where: { id: enrolmentId, tenantId, deletedAt: null },
      include: {
        participant: { select: { id: true, status: true } },
      },
    });
    if (!enrolment) return { promoted: false, reason: 'enrolment not found' };

    if (
      enrolment.status !== EnrolmentStatus.FEE_PENDING &&
      enrolment.status !== EnrolmentStatus.DOCUMENTS_PENDING
    ) {
      return { promoted: false, reason: `enrolment in status ${enrolment.status}` };
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { balanceThreshold: true },
    });
    const threshold = tenant?.balanceThreshold ?? new Prisma.Decimal(0);

    const balanceOk = enrolment.balance.lte(threshold);
    const docsOk = await this.documentsVerified(enrolment.participant.id);

    if (!balanceOk) {
      return { promoted: false, reason: `balance ${enrolment.balance.toString()} > threshold ${threshold.toString()}` };
    }
    if (!docsOk) {
      return { promoted: false, reason: 'documents not all verified' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.enrolment.update({
        where: { id: enrolment.id },
        data: { status: EnrolmentStatus.ACTIVE },
      });
      // Promote the participant only if they're not already ACTIVE or beyond.
      if (
        enrolment.participant.status === ParticipantStatus.FEE_PENDING ||
        enrolment.participant.status === ParticipantStatus.DOCUMENTS_PENDING
      ) {
        await tx.participant.update({
          where: { id: enrolment.participant.id },
          data: { status: ParticipantStatus.ACTIVE },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: null,
          action: 'AUTO_PROMOTED_TO_ACTIVE',
          resource: 'enrolment',
          resourceId: enrolment.id,
          afterState: {
            balance: enrolment.balance.toString(),
            threshold: threshold.toString(),
            docsVerified: true,
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `[tryPromote] promoted enrolment=${enrolment.id} participant=${enrolment.participant.id}`,
    );
    return { promoted: true, reason: 'threshold + docs OK' };
  }

  /**
   * Documents-verified check.
   *
   * Today: at least one document is VERIFIED. This matches the
   * existing DocumentsService promotion logic (DOCUMENTS_PENDING →
   * FEE_PENDING) which uses the same heuristic.
   *
   * Future: replace with per-tenant required document type list.
   */
  private async documentsVerified(participantId: string): Promise<boolean> {
    const count = await this.prisma.document.count({
      where: { participantId, status: 'VERIFIED', deletedAt: null },
    });
    return count > 0;
  }
}
