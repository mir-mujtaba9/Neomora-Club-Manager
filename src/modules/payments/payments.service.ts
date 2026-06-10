import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
  type Payment,
} from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { FeesService } from '../fees/fees.service.js';
import type { FindPaymentsDto } from './dto/find-payments.dto.js';

/**
 * Plan F — payments orchestration. Handles:
 *
 *   • F-15 offline recording (cash, bank transfer) with optional proof
 *   • F-15 verification / rejection workflow
 *   • F-16 partial payments via FeesService.recomputeBalance
 *   • F-19 hook for auto-promotion (placeholder — wired in F-11)
 *
 * Gateway-routed payments (Moyasar / PayTabs / HyperPay) arrive via
 * the webhook processor (F-8); this service exposes `applyGatewayResult`
 * for that processor so the same balance / receipt / promotion flow
 * runs regardless of source.
 *
 * IMPORTANT: receipt PDF generation and notifications are dispatched
 * AFTER the verify transaction commits — both are best-effort so a
 * channel hiccup doesn't roll back the financial state change.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  /** Set by PaymentsModule after construction (avoid circular module deps). */
  private onVerifiedHooks: Array<(payment: Payment) => Promise<void>> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeesService,
  ) {}

  /**
   * Register a fire-and-forget callback that runs AFTER a payment
   * transitions to COMPLETED. Used by:
   *   • Receipt processor — generate PDF, set `receiptKey`
   *   • Notifications     — send PAYMENT_CONFIRM
   *   • Auto-promotion    — flip Participant FEE_PENDING → ACTIVE
   *
   * Hooks are awaited sequentially but failures are caught and logged;
   * one failing hook does not stop the others.
   */
  registerOnVerifiedHook(hook: (payment: Payment) => Promise<void>): void {
    this.onVerifiedHooks.push(hook);
  }

  // ─── F-15 record (offline / cash / bank xfer) ─────────────────────

  /**
   * Record an externally-collected payment. Creates the row at
   * PENDING_VERIFICATION — staff must then call /verify to apply the
   * funds to the enrolment balance.
   *
   * Idempotent via `idempotencyKey` (column @unique). A duplicate POST
   * returns 409 instead of double-creating.
   */
  async recordOffline(
    tenantId: string,
    user: { id: string; role: UserRole },
    input: {
      enrolmentId: string;
      invoiceId?: string;
      method: PaymentMethod;
      amount: number;
      proofKey?: string;
      idempotencyKey: string;
    },
  ): Promise<Payment> {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.FINANCE_OFFICER &&
      user.role !== UserRole.LOCATION_MANAGER
    ) {
      throw new ForbiddenException('You may not record payments');
    }

    if (input.method === PaymentMethod.ONLINE_CARD) {
      throw new BadRequestException(
        'ONLINE_CARD must arrive via gateway webhook, not /payments/offline',
      );
    }

    const enrolment = await this.prisma.enrolment.findFirst({
      where: { id: input.enrolmentId, tenantId, deletedAt: null },
      select: { id: true, locationId: true, balance: true },
    });
    if (!enrolment) throw new NotFoundException('Enrolment not found');

    if (
      user.role === UserRole.LOCATION_MANAGER &&
      enrolment.locationId !== (user as any).locationId
    ) {
      throw new ForbiddenException('Enrolment is not in your location');
    }

    if (input.invoiceId) {
      const inv = await this.prisma.invoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId,
          enrolmentId: input.enrolmentId,
          deletedAt: null,
        },
        select: { id: true, status: true },
      });
      if (!inv) throw new NotFoundException('Invoice not found for this enrolment');
      if (inv.status === InvoiceStatus.PAID) {
        throw new ConflictException('Invoice is already PAID');
      }
    }

    // Detect duplicate via idempotencyKey BEFORE attempting create so we
    // can return the existing row rather than a 409 P2002 from Prisma.
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new ConflictException(
          'Idempotency key already used in another tenant',
        );
      }
      return existing;
    }

    return this.prisma.payment.create({
      data: {
        tenantId,
        enrolmentId: input.enrolmentId,
        invoiceId: input.invoiceId ?? null,
        recordedById: user.id,
        gateway: PaymentGateway.OFFLINE,
        method: input.method,
        amount: new Prisma.Decimal(input.amount),
        status: PaymentStatus.PENDING_VERIFICATION,
        proofKey: input.proofKey ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  // ─── F-15 verify ──────────────────────────────────────────────────

  /**
   * Approve a PENDING_VERIFICATION payment. Inside a single tx:
   *   1. Flip status → COMPLETED, set verifiedAt/verifiedById/paidAt.
   *   2. Mark linked invoice PAID when amount covers it.
   *   3. Call FeesService.recomputeBalance to refresh enrolment totals.
   *
   * After commit (best-effort):
   *   • run registered onVerifiedHooks (PDF, notifications, promotion)
   */
  async verify(
    tenantId: string,
    user: { id: string; role: UserRole },
    paymentId: string,
  ): Promise<Payment> {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.FINANCE_OFFICER
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN or FINANCE_OFFICER can verify payments',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, tenantId },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== PaymentStatus.PENDING_VERIFICATION) {
        throw new ConflictException(
          `Cannot verify payment in status ${payment.status}`,
        );
      }

      const verified = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          verifiedById: user.id,
          verifiedAt: new Date(),
          paidAt: new Date(),
          failureReason: null,
        },
      });

      // Recompute aggregated balance from COMPLETED payments.
      await this.fees.recomputeBalance(tx, payment.enrolmentId);

      // Mark linked invoice paid if this payment covers it. Partial
      // payments leave the invoice PENDING — finance must record
      // additional payments to fully pay it.
      if (payment.invoiceId) {
        const inv = await tx.invoice.findUnique({
          where: { id: payment.invoiceId },
          select: { amount: true, status: true },
        });
        if (inv && inv.status !== InvoiceStatus.PAID) {
          const otherPaid = await tx.payment.aggregate({
            where: {
              invoiceId: payment.invoiceId,
              status: PaymentStatus.COMPLETED,
            },
            _sum: { amount: true },
          });
          const sum = otherPaid._sum.amount ?? new Prisma.Decimal(0);
          if (sum.gte(inv.amount)) {
            await tx.invoice.update({
              where: { id: payment.invoiceId },
              data: { status: InvoiceStatus.PAID },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: 'PAYMENT_VERIFIED',
          resource: 'payment',
          resourceId: payment.id,
          beforeState: { status: payment.status } as Prisma.InputJsonValue,
          afterState: {
            status: PaymentStatus.COMPLETED,
            amount: payment.amount.toString(),
          } as Prisma.InputJsonValue,
        },
      });

      return verified;
    });

    // Post-commit hooks — fire-and-forget so a hook failure does not
    // surface as a verify error.
    void this.runHooks(updated);

    return updated;
  }

  // ─── F-15 reject ──────────────────────────────────────────────────

  /**
   * Reject a PENDING_VERIFICATION payment. Sets status=FAILED,
   * captures `failureReason`, leaves `proofKey` intact for audit.
   * Balance is NOT changed because PENDING_VERIFICATION never
   * contributed to paidAmount.
   */
  async reject(
    tenantId: string,
    user: { id: string; role: UserRole },
    paymentId: string,
    reason?: string,
  ): Promise<Payment> {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.FINANCE_OFFICER
    ) {
      throw new ForbiddenException('You may not reject payments');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, tenantId },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== PaymentStatus.PENDING_VERIFICATION) {
        throw new ConflictException(
          `Cannot reject payment in status ${payment.status}`,
        );
      }

      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          verifiedById: user.id,
          verifiedAt: new Date(),
          failureReason: reason ?? 'Rejected by finance',
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: 'PAYMENT_REJECTED',
          resource: 'payment',
          resourceId: payment.id,
          beforeState: { status: payment.status } as Prisma.InputJsonValue,
          afterState: {
            status: PaymentStatus.FAILED,
            failureReason: reason ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  // ─── webhook applier (F-14, called from WebhookProcessor) ─────────

  /**
   * Apply a gateway-confirmed payment outcome. Used by the webhook
   * processor after a strategy parses a verified webhook payload.
   *
   * Creates the Payment if not present (matched by gatewayRef), else
   * updates an existing PENDING gateway-side row. Reuses the same
   * recomputeBalance + auto-promote pipeline as offline verify.
   */
  async applyGatewayResult(
    tenantId: string,
    input: {
      gateway: PaymentGateway;
      gatewayRef: string;
      method: PaymentMethod;
      amount: number;
      enrolmentId: string;
      invoiceId?: string | null;
      status: 'COMPLETED' | 'FAILED';
      idempotencyKey: string;
      failureReason?: string;
    },
  ): Promise<Payment> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Find existing by gatewayRef (preferred) or by idempotencyKey.
      const existing =
        (await tx.payment.findUnique({
          where: { gatewayRef: input.gatewayRef },
        })) ??
        (await tx.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        }));

      const isCompleted = input.status === PaymentStatus.COMPLETED;

      const payment = existing
        ? await tx.payment.update({
            where: { id: existing.id },
            data: {
              status: input.status,
              paidAt: isCompleted ? new Date() : existing.paidAt,
              verifiedAt: new Date(),
              failureReason: input.failureReason ?? null,
              amount: new Prisma.Decimal(input.amount),
            },
          })
        : await tx.payment.create({
            data: {
              tenantId,
              enrolmentId: input.enrolmentId,
              invoiceId: input.invoiceId ?? null,
              gateway: input.gateway,
              gatewayRef: input.gatewayRef,
              method: input.method,
              amount: new Prisma.Decimal(input.amount),
              status: input.status,
              idempotencyKey: input.idempotencyKey,
              paidAt: isCompleted ? new Date() : null,
              verifiedAt: new Date(),
              failureReason: input.failureReason ?? null,
            },
          });

      if (isCompleted) {
        await this.fees.recomputeBalance(tx, payment.enrolmentId);
        if (payment.invoiceId) {
          await this.maybeMarkInvoicePaid(tx, payment.invoiceId);
        }
      }

      return payment;
    });

    if (input.status === PaymentStatus.COMPLETED) {
      void this.runHooks(result);
    }
    return result;
  }

  // ─── reads ────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    user: { role: UserRole; locationId?: string | null },
    query: FindPaymentsDto,
  ) {
    const { enrolmentId, status, gateway, page = 1, limit = 20 } = query;
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(enrolmentId && { enrolmentId }),
      ...(status && { status }),
      ...(gateway && { gateway }),
    };

    if (user.role === UserRole.LOCATION_MANAGER && user.locationId) {
      where.enrolment = { locationId: user.locationId };
    }

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findOne(tenantId: string, paymentId: string): Promise<Payment> {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  // ─── internals ────────────────────────────────────────────────────

  private async maybeMarkInvoicePaid(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<void> {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { amount: true, status: true },
    });
    if (!inv || inv.status === InvoiceStatus.PAID) return;

    const totals = await tx.payment.aggregate({
      where: { invoiceId, status: PaymentStatus.COMPLETED },
      _sum: { amount: true },
    });
    const sum = totals._sum.amount ?? new Prisma.Decimal(0);
    if (sum.gte(inv.amount)) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.PAID },
      });
    }
  }

  private async runHooks(payment: Payment): Promise<void> {
    for (const hook of this.onVerifiedHooks) {
      try {
        await hook(payment);
      } catch (err) {
        this.logger.error(
          `[runHooks] hook failed for payment=${payment.id}: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }
  }
}
