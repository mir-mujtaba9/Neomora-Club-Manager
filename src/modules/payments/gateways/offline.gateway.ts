import { Injectable } from '@nestjs/common';
import { PaymentGateway, PaymentMethod } from '@prisma/client';
import type { Invoice } from '@prisma/client';
import type { PaymentGatewayStrategy } from './gateway.interface.js';

/**
 * OFFLINE "gateway" — the no-cost-no-creds path that is always usable.
 *
 * createCheckoutLink → returns the guardian-portal URL where parents
 *   see the tenant's bank details and (eventually) upload proof of
 *   payment. The link doesn't expire because it's just a portal URL.
 *
 * verifyWebhookSignature / parseWebhookEvent → never actually called
 *   in production (offline payments flow through staff /verify), but
 *   the contract requires them. They return safe no-ops so accidental
 *   wiring doesn't crash the app.
 */
@Injectable()
export class OfflineGateway implements PaymentGatewayStrategy {
  readonly gateway = PaymentGateway.OFFLINE;

  async createCheckoutLink(args: {
    tenantId: string;
    invoice: Invoice;
    guardianPortalToken: string;
    webBaseUrl: string;
  }): Promise<{ url: string; expiresAt?: Date }> {
    const url = `${args.webBaseUrl.replace(/\/+$/, '')}/portal/${args.guardianPortalToken}/pay/${args.invoice.id}`;
    // OFFLINE links never expire — they're just portal URLs the parent
    // can revisit until payment is recorded.
    return { url };
  }

  verifyWebhookSignature(): boolean {
    // OFFLINE never receives webhooks. Returning false is safe — if a
    // real webhook is mis-routed here, it gets rejected.
    return false;
  }

  parseWebhookEvent(): never {
    throw new Error('OFFLINE gateway does not process webhook events');
  }

  /** Helper used by the (eventual) OFFLINE → COMPLETED flow if/when we
   *  build an auto-confirm capability. Returns the same shape as the
   *  real gateways' parseWebhookEvent for code re-use. */
  buildSyntheticResult(args: {
    tenantId: string;
    invoice: Invoice;
    enrolmentId: string;
    amount: number;
    paymentId: string;
  }): {
    gatewayRef: string;
    enrolmentId: string;
    invoiceId: string;
    tenantId: string;
    status: 'COMPLETED';
    method: PaymentMethod;
    amount: number;
    idempotencyKey: string;
  } {
    return {
      gatewayRef: `offline:${args.paymentId}`,
      enrolmentId: args.enrolmentId,
      invoiceId: args.invoice.id,
      tenantId: args.tenantId,
      status: 'COMPLETED',
      method: PaymentMethod.CASH,
      amount: args.amount,
      idempotencyKey: `offline:${args.paymentId}`,
    };
  }
}
