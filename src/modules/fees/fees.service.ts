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
  Prisma,
  UserRole,
  type Enrolment,
  type Invoice,
  type PaymentPlan,
  PaymentPlanType,
} from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';
import { computeEnrolmentFee } from './fees.calculator.js';
import { computeInstalments, type InstalmentSpec } from './instalment-generator.js';

/**
 * Plan F — orchestrates fee calculation, payment plan creation, and
 * invoice generation. Single source of truth for the lifecycle:
 *
 *   ENROLMENT  ──createPlanForEnrolment──▶  PaymentPlan  +  Invoice[]
 *               ──setFeeOverride──▶         (recalc totalFee + balance + audit)
 *               ──recomputeBalance──▶       (called from PaymentsService)
 *
 * No other module is allowed to write to Invoice — they all go through
 * here so the audit log stays complete.
 */
@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── plan creation ─────────────────────────────────────────────────

  /**
   * Generate the invoice schedule for a single enrolment.
   *
   * Behavior:
   *   1. Validates the enrolment exists, isn't soft-deleted, and isn't
   *      already linked to invoices (idempotency — caller should clear
   *      the prior plan first if regenerating).
   *   2. Loads the session for date range.
   *   3. Reuses an existing session-level PaymentPlan if one matches
   *      (same type + count), else creates one. PaymentPlan is shared
   *      across enrolments — it's the SCHEDULE TEMPLATE; Invoice rows
   *      are the per-enrolment realisations.
   *   4. Calls instalment-generator to build the per-invoice spec.
   *   5. Inserts Invoice rows in the same transaction. Invoice numbers
   *      come from the tenant sequence (atomic, collision-free).
   *   6. Writes an AuditLog row capturing the fee breakdown.
   */
  async createPlanForEnrolment(
    enrolmentId: string,
    tenantId: string,
    user: { id: string; role: UserRole },
    planType: PaymentPlanType,
    instalmentCount?: number,
  ): Promise<{ plan: PaymentPlan; invoices: Invoice[] }> {
    return this.prisma.$transaction(async (tx) => {
      const enrolment = await tx.enrolment.findFirst({
        where: { id: enrolmentId, tenantId, deletedAt: null },
        include: {
          session: true,
          invoices: { where: { deletedAt: null }, select: { id: true } },
        },
      });
      if (!enrolment) throw new NotFoundException('Enrolment not found');
      if (enrolment.invoices.length > 0) {
        throw new ConflictException(
          'Enrolment already has an active payment plan; delete prior invoices before regenerating',
        );
      }

      const effectiveCount =
        planType === PaymentPlanType.FULL ? 1 : (instalmentCount ?? 1);
      if (planType !== PaymentPlanType.FULL && effectiveCount < 1) {
        throw new BadRequestException(
          'instalmentCount must be >= 1 for MONTHLY / SEASONAL plans',
        );
      }

      // Use the enrolment's already-computed totalFee. The fees
      // calculator (computeEnrolmentFee) is re-applied here ONLY to
      // capture the breakdown for the audit log — the canonical total
      // is what's already on the Enrolment row.
      const totalFee = new Prisma.Decimal(enrolment.totalFee.toString());
      const perInstalmentAmount = totalFee.div(effectiveCount).toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      );

      // Reuse a matching session-level PaymentPlan template if one
      // exists, so two enrolments on the same plan share metadata.
      let plan = await tx.paymentPlan.findFirst({
        where: {
          tenantId,
          sessionId: enrolment.sessionId,
          deletedAt: null,
          type: planType,
          instalmentCount: effectiveCount,
        },
      });
      if (!plan) {
        plan = await tx.paymentPlan.create({
          data: {
            tenantId,
            sessionId: enrolment.sessionId,
            type: planType,
            instalmentCount: effectiveCount,
            instalmentAmount: perInstalmentAmount,
            dueDates: [],
          },
        });
      }

      const specs = computeInstalments(
        totalFee,
        effectiveCount,
        planType,
        enrolment.session.startDate,
        enrolment.session.endDate,
      );

      const invoices: Invoice[] = [];
      for (const spec of specs) {
        const seq = await nextTenantSequence(tx, tenantId, 'invoice');
        const inv = await tx.invoice.create({
          data: {
            tenantId,
            enrolmentId: enrolment.id,
            invoiceNumber: this.formatInvoiceNumber(tenantId, seq),
            amount: spec.amount,
            dueDate: spec.dueDate,
            status: InvoiceStatus.PENDING,
            paymentPlanType: planType,
            instalmentNo: planType === PaymentPlanType.FULL ? null : spec.instalmentNo,
            instalmentTotal: planType === PaymentPlanType.FULL ? null : spec.instalmentTotal,
          },
        });
        invoices.push(inv);
      }

      // Persist actual due dates on the plan for downstream consumers.
      await tx.paymentPlan.update({
        where: { id: plan.id },
        data: { dueDates: specs.map((s) => s.dueDate) },
      });

      // Update enrolment.paymentPlanType to match in case it differs.
      if (enrolment.paymentPlanType !== planType) {
        await tx.enrolment.update({
          where: { id: enrolment.id },
          data: { paymentPlanType: planType },
        });
      }

      // ── F-11 audit log ─────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: 'FEE_PLAN_CREATED',
          resource: 'enrolment',
          resourceId: enrolment.id,
          beforeState: undefined,
          afterState: {
            planId: plan.id,
            planType,
            instalmentCount: effectiveCount,
            totalFee: totalFee.toString(),
            invoices: specs.map((s) => ({
              instalmentNo: s.instalmentNo,
              dueDate: s.dueDate.toISOString(),
              amount: s.amount.toString(),
            })),
          } as Prisma.InputJsonValue,
        },
      });

      return { plan, invoices };
    });
  }

  // ─── fee override (F-09) ───────────────────────────────────────────

  /**
   * Set or clear `Enrolment.feeOverride`. Recomputes `totalFee` via the
   * canonical fees calculator (override → location → base), then
   * re-derives `balance = totalFee - paidAmount`.
   *
   * Writes an AuditLog row with full before/after snapshot.
   *
   * Restriction: only SUPER_ADMIN and FINANCE_OFFICER may override
   * fees. LOCATION_MANAGER cannot (they don't own billing).
   *
   * Refuses if the enrolment already has invoices — the override
   * would silently desync invoice amounts from totalFee. Caller
   * must drop the plan first.
   */
  async setFeeOverride(
    enrolmentId: string,
    tenantId: string,
    user: { id: string; role: UserRole },
    amount: number | null,
    reason?: string,
  ): Promise<Enrolment> {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.FINANCE_OFFICER
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN or FINANCE_OFFICER can override enrolment fees',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const enrolment = await tx.enrolment.findFirst({
        where: { id: enrolmentId, tenantId, deletedAt: null },
        include: {
          session: { select: { baseFee: true } },
          invoices: { where: { deletedAt: null }, select: { id: true } },
        },
      });
      if (!enrolment) throw new NotFoundException('Enrolment not found');
      if (enrolment.invoices.length > 0) {
        throw new ConflictException(
          'Cannot change fee override while active invoices exist; cancel them first',
        );
      }

      // Load session-location override.
      const sl = await tx.sessionLocation.findFirst({
        where: {
          sessionId: enrolment.sessionId,
          locationId: enrolment.locationId,
        },
        select: { feeOverride: true },
      });

      const newOverride =
        amount === null || amount === undefined
          ? null
          : new Prisma.Decimal(amount);

      const currentVatRate = await tx.vatRate.findFirst({
        where: { tenantId, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
      });

      const result = computeEnrolmentFee({
        enrolmentFeeOverride: newOverride,
        sessionLocationFeeOverride: sl?.feeOverride ?? null,
        sessionBaseFee: enrolment.session.baseFee,
        activeVatRate: currentVatRate?.rate ?? null,
      });

      const newBalance = result.total.minus(enrolment.paidAmount);

      const beforeState = {
        feeOverride: enrolment.feeOverride?.toString() ?? null,
        totalFee: enrolment.totalFee.toString(),
        balance: enrolment.balance.toString(),
      };

      const updated = await tx.enrolment.update({
        where: { id: enrolment.id },
        data: {
          feeOverride: newOverride,
          totalFee: result.total,
          balance: newBalance,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: 'FEE_OVERRIDE_SET',
          resource: 'enrolment',
          resourceId: enrolment.id,
          beforeState: beforeState as Prisma.InputJsonValue,
          afterState: {
            feeOverride: newOverride?.toString() ?? null,
            totalFee: result.total.toString(),
            balance: newBalance.toString(),
            source: result.source,
            breakdown: result.breakdown,
            reason: reason ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  // ─── invoice listing (F-13, F-16) ──────────────────────────────────

  async listInvoices(
    enrolmentId: string,
    tenantId: string,
    user: { role: UserRole; locationId?: string | null },
  ) {
    const enrolment = await this.prisma.enrolment.findFirst({
      where: { id: enrolmentId, tenantId, deletedAt: null },
      select: { id: true, locationId: true },
    });
    if (!enrolment) throw new NotFoundException('Enrolment not found');
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId &&
      enrolment.locationId !== user.locationId
    ) {
      throw new ForbiddenException('Enrolment is not in your location');
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { enrolmentId, tenantId, deletedAt: null },
      orderBy: [{ instalmentNo: 'asc' }, { dueDate: 'asc' }],
    });

    const today = stripTime(new Date());
    return invoices.map((inv) => {
      const dueDay = stripTime(inv.dueDate);
      const daysUntilDue = Math.round(
        (dueDay.getTime() - today.getTime()) / 86_400_000,
      );
      return {
        ...inv,
        daysUntilDue,
        isOverdue: inv.status !== InvoiceStatus.PAID && daysUntilDue < 0,
      };
    });
  }

  // ─── balance helper (called from PaymentsService.verify/reject) ────

  /**
   * Re-derive `paidAmount` from the SUM of COMPLETED payments on this
   * enrolment, then `balance = totalFee - paidAmount`. Always called
   * inside an existing transaction.
   *
   * Why recompute instead of incrementing? Defence in depth:
   *   - A PENDING_VERIFICATION → FAILED transition must DECREMENT
   *     paidAmount even though no debit happened (because nothing
   *     was added on PENDING_VERIFICATION).
   *   - A re-run / replay never double-counts.
   */
  async recomputeBalance(
    tx: Prisma.TransactionClient,
    enrolmentId: string,
  ): Promise<{ paidAmount: Prisma.Decimal; balance: Prisma.Decimal }> {
    const enrolment = await tx.enrolment.findUnique({
      where: { id: enrolmentId },
      select: { totalFee: true },
    });
    if (!enrolment) throw new NotFoundException('Enrolment not found');

    const agg = await tx.payment.aggregate({
      where: { enrolmentId, status: 'COMPLETED' },
      _sum: { amount: true },
    });
    const paidAmount = agg._sum.amount ?? new Prisma.Decimal(0);
    const balance = new Prisma.Decimal(enrolment.totalFee.toString()).minus(
      paidAmount,
    );

    await tx.enrolment.update({
      where: { id: enrolmentId },
      data: { paidAmount, balance },
    });

    return { paidAmount, balance };
  }

  // ─── internal helpers ──────────────────────────────────────────────

  /**
   * Format e.g. (tenantId='1a2b3c4d-...', 42) → "INV-1a2b3c4d-000042".
   *
   * Includes the tenant ID prefix because `Invoice.invoiceNumber` is
   * globally `@unique` but `nextTenantSequence` is per-tenant — without
   * the prefix two tenants would collide on `INV-000001`.
   */
  private formatInvoiceNumber(tenantId: string, seq: number): string {
    const prefix = tenantId.replace(/-/g, '').slice(0, 8);
    return `INV-${prefix}-${seq.toString().padStart(6, '0')}`;
  }
}

function stripTime(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
