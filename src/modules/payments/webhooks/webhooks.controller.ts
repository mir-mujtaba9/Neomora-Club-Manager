import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentGateway, Prisma } from '@prisma/client';

import { Public } from '../../../common/decorators/roles.decorator.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

/**
 * Plan F — webhook ingestion endpoint.
 *
 *   POST /webhooks/payments/:gateway
 *
 * Public (no auth) because gateways can't carry our JWT. Each gateway
 * authenticates its own webhook via a signed header that we verify
 * downstream in the WebhookProcessor.
 *
 * Design notes:
 *   • This handler returns 200 IMMEDIATELY after persisting the raw
 *     payload — gateways will retry aggressively on non-2xx. Even
 *     malformed payloads get 200 + a row written (audit trail).
 *   • Verification + parsing are deferred to WebhookProcessor (cron)
 *     so this endpoint never depends on per-tenant config or external
 *     network calls.
 *   • We DO NOT trust the `gateway` path param to identify the tenant;
 *     tenant is recovered from the payload metadata during processing.
 */
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Post(':gateway')
  @Public()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('gateway') gatewayParam: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: unknown,
    @Req() req: Request,
  ): Promise<{ received: true }> {
    const gateway = this.normaliseGateway(gatewayParam);
    if (!gateway) {
      // Even unknown gateways get a 200 + audit row so we can debug
      // mis-routed calls. We tag the row with PaymentGateway.OFFLINE
      // as a sentinel because the enum has no UNKNOWN variant.
      await this.persistRaw(PaymentGateway.OFFLINE, headers, payload, req, 'unknown-gateway');
      return { received: true };
    }

    await this.persistRaw(gateway, headers, payload, req);
    return { received: true };
  }

  private normaliseGateway(p: string): PaymentGateway | null {
    const upper = p.toUpperCase();
    if (upper === 'MOYASAR') return PaymentGateway.MOYASAR;
    if (upper === 'PAYTABS') return PaymentGateway.PAYTABS;
    if (upper === 'HYPERPAY') return PaymentGateway.HYPERPAY;
    return null;
  }

  private async persistRaw(
    gateway: PaymentGateway,
    headers: Record<string, string>,
    payload: unknown,
    req: Request,
    failureReason: string | null = null,
  ): Promise<void> {
    try {
      // signature header is gateway-specific — store all headers and
      // let the strategy pick the right key when verifying.
      const signature =
        headers['x-signature'] ??
        headers['x-paytabs-signature'] ??
        headers['paymentid'] ??
        null;

      await this.prisma.cmPaymentWebhookEvent.create({
        data: {
          gateway,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          headers: headers as unknown as Prisma.InputJsonValue,
          signature,
          processed: false,
          failureReason,
        },
      });
    } catch {
      // Swallow — we must always return 200. The gateway will retry
      // if it doesn't get a successful response, and we can recover
      // the missed event from gateway-side logs.
    }
  }
}
