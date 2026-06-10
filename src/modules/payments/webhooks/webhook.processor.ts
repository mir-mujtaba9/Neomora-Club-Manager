import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentGateway, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PaymentGatewayFactory } from '../gateways/gateway.factory.js';
import { PaymentsService } from '../payments.service.js';

/**
 * Plan F — webhook processor.
 *
 * Runs every minute. For each unprocessed `cm_payment_webhook_events`:
 *   1. Resolve strategy via PaymentGatewayFactory.byGateway.
 *   2. Verify signature. Mark failure_reason + processed=true on bad sig.
 *   3. Parse payload. Mark failure_reason + processed=true on parse error.
 *   4. Apply via PaymentsService.applyGatewayResult.
 *   5. Mark processed=true + processed_at.
 *
 * OFFLINE gateway events (sentinel) and stub gateways throw on every
 * call — we capture the error message into failure_reason and mark
 * processed=true so they don't clog the queue.
 *
 * Idempotency is provided by PaymentsService.applyGatewayResult which
 * de-duplicates on `gatewayRef` or `idempotencyKey`. Re-running this
 * cron over the same event would no-op the second pass.
 */
@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayFactory,
    private readonly payments: PaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'payment-webhook-processor' })
  async run(): Promise<void> {
    if (!this.config.get<boolean>('app.paymentWebhookProcessorEnabled')) {
      return;
    }

    const batchSize = 50;
    let pending: Array<{
      id: string;
      gateway: PaymentGateway;
      payload: unknown;
      headers: unknown;
    }>;

    try {
      pending = await this.prisma.cmPaymentWebhookEvent.findMany({
        where: { processed: false },
        orderBy: { receivedAt: 'asc' },
        take: batchSize,
        select: { id: true, gateway: true, payload: true, headers: true },
      });
    } catch (err) {
      this.logger.error(
        `[run] failed to query pending events: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      return;
    }

    if (pending.length === 0) return;

    this.logger.log(`[run] processing ${pending.length} pending event(s)`);

    for (const evt of pending) {
      await this.processOne(evt);
    }
  }

  private async processOne(evt: {
    id: string;
    gateway: PaymentGateway;
    payload: unknown;
    headers: unknown;
  }): Promise<void> {
    const headers = (evt.headers ?? {}) as Record<string, string>;

    try {
      // OFFLINE sentinel is used by the controller for unknown
      // gateways. Just mark it failed and move on.
      if (evt.gateway === PaymentGateway.OFFLINE) {
        await this.markProcessed(evt.id, 'unknown gateway — discarded', false);
        return;
      }

      const strategy = this.gateways.byGateway(evt.gateway);

      // 1. Verify signature.
      const sigValid = strategy.verifyWebhookSignature({
        payload: evt.payload,
        headers,
      });
      if (!sigValid) {
        await this.markProcessed(evt.id, 'signature invalid', false);
        return;
      }

      // 2. Parse — the stub strategies throw NotImplementedException
      // here, which we catch and record.
      let parsed: ReturnType<typeof strategy.parseWebhookEvent>;
      try {
        parsed = strategy.parseWebhookEvent({
          payload: evt.payload,
          headers,
        });
      } catch (err) {
        await this.markProcessed(
          evt.id,
          `parse failed: ${(err as Error)?.message ?? 'unknown'}`,
          true,
        );
        return;
      }

      // 3. Apply.
      await this.payments.applyGatewayResult(parsed.tenantId, {
        gateway: evt.gateway,
        gatewayRef: parsed.gatewayRef,
        method: parsed.method,
        amount: parsed.amount,
        enrolmentId: parsed.enrolmentId,
        invoiceId: parsed.invoiceId ?? null,
        status: parsed.status,
        idempotencyKey: parsed.idempotencyKey,
        failureReason: parsed.failureReason,
      });

      await this.markProcessed(evt.id, null, true);
    } catch (err) {
      this.logger.error(
        `[processOne] event=${evt.id} failed: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      // Mark processed=true even on unexpected errors — otherwise a
      // poison-pill event would block the queue forever.
      await this.markProcessed(
        evt.id,
        `unexpected: ${(err as Error)?.message ?? 'unknown'}`,
        false,
      );
    }
  }

  private async markProcessed(
    id: string,
    failureReason: string | null,
    signatureValid: boolean,
  ): Promise<void> {
    await this.prisma.cmPaymentWebhookEvent.update({
      where: { id },
      data: {
        processed: true,
        processedAt: new Date(),
        signatureValid,
        failureReason,
      },
    });
  }
}
