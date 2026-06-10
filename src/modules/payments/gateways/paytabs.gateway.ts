import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import type { PaymentGatewayStrategy } from './gateway.interface.js';

/**
 * PayTabs — popular MEA gateway.
 *
 * STUBBED: requires PAYTABS_PROFILE_ID, PAYTABS_SERVER_KEY, and
 * PAYTABS_REGION env vars before going live.
 *
 * When enabling, the PayTabs "Hosted Page" flow is the lowest-effort:
 *   POST /payment/request with `tran_type=sale`, `tran_class=ecom`
 *   Returns `redirect_url` to send the parent to.
 * Webhook signature uses HMAC-SHA256 over the JSON payload with
 * the server key as the secret.
 */
@Injectable()
export class PayTabsGateway implements PaymentGatewayStrategy {
  readonly gateway = PaymentGateway.PAYTABS;

  async createCheckoutLink(): Promise<{ url: string }> {
    throw new NotImplementedException(
      'PAYTABS gateway not configured — set PAYTABS_* env vars and replace this stub',
    );
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhookEvent(): never {
    throw new NotImplementedException('PAYTABS webhook parser not implemented');
  }
}
