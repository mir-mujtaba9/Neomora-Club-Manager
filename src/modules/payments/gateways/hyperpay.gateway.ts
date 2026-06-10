import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import type { PaymentGatewayStrategy } from './gateway.interface.js';

/**
 * HyperPay — pan-MENA gateway with strong 3-D Secure support.
 *
 * STUBBED: requires HYPERPAY_ACCESS_TOKEN, HYPERPAY_ENTITY_ID, and
 * HYPERPAY_WEBHOOK_SECRET. Two-step flow:
 *   1. POST /v1/checkouts (server-side, returns `id` + `ndc`)
 *   2. Front-end loads paymentWidgets.js with that `id`
 *
 * Webhook authentication uses HMAC-SHA256 over the raw body with
 * the webhook secret. Status mapping:
 *   resultDescription contains "successfully" → COMPLETED
 *   resultDescription contains "rejected"     → FAILED
 */
@Injectable()
export class HyperPayGateway implements PaymentGatewayStrategy {
  readonly gateway = PaymentGateway.HYPERPAY;

  async createCheckoutLink(): Promise<{ url: string }> {
    throw new NotImplementedException(
      'HYPERPAY gateway not configured — set HYPERPAY_* env vars and replace this stub',
    );
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhookEvent(): never {
    throw new NotImplementedException('HYPERPAY webhook parser not implemented');
  }
}
