import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import type { PaymentGatewayStrategy } from './gateway.interface.js';

/**
 * Moyasar — Saudi gateway used widely in KSA.
 *
 * STUBBED: production wiring requires MOYASAR_PUBLISHABLE_KEY,
 * MOYASAR_SECRET_KEY, and webhook secret. Until those are configured
 * every method throws 501 — the rest of the system runs unaffected.
 *
 * When enabling:
 *   1. Set tenant.defaultPaymentGateway = MOYASAR
 *   2. POST /api/v1/payments/v1/invoices to create checkout sessions
 *   3. Webhook signature is HMAC-SHA256 over rawBody using webhookSecret
 *   4. Map status mapping:
 *        "paid"     → PaymentStatus.COMPLETED
 *        "failed"   → PaymentStatus.FAILED
 *        "pending"  → ignore (we only persist final states)
 */
@Injectable()
export class MoyasarGateway implements PaymentGatewayStrategy {
  readonly gateway = PaymentGateway.MOYASAR;

  async createCheckoutLink(): Promise<{ url: string }> {
    throw new NotImplementedException(
      'MOYASAR gateway not configured — set MOYASAR_* env vars and replace this stub',
    );
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhookEvent(): never {
    throw new NotImplementedException('MOYASAR webhook parser not implemented');
  }
}
