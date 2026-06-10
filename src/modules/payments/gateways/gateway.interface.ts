import type { Invoice, PaymentGateway, PaymentMethod } from '@prisma/client';

/**
 * Common contract every payment-gateway integration must satisfy.
 *
 * Why an interface and not a base class:
 *   • Strategies have no shared state — each is a thin adapter over an
 *     external SDK or HTTP call. An interface keeps that boundary clean.
 *   • Nest DI can hand any implementation to the factory based on the
 *     tenant's `defaultPaymentGateway` field.
 *
 * Lifecycle (offline as well as online):
 *
 *   1. PaymentLinkService asks the factory for the tenant's strategy.
 *   2. strategy.createCheckoutLink(invoice)  → URL + optional expiry.
 *   3. Guardian completes payment in the external UI (offline = our portal).
 *   4. Gateway POSTs to /webhooks/payments/:gateway (real ones) — we
 *      write the raw payload to cm_payment_webhook_events.
 *   5. WebhookProcessor calls strategy.verifyWebhookSignature, then
 *      strategy.parseWebhookEvent — the parsed result is fed to
 *      PaymentsService.applyGatewayResult.
 *
 * OFFLINE gateway never reaches steps 4–5 — the staff verify path
 * applies funds directly. Its verify/parse implementations are still
 * present (returning safe no-ops) so the contract stays single.
 */
export interface PaymentGatewayStrategy {
  /** Internal enum identifying which strategy this instance is. */
  readonly gateway: PaymentGateway;

  /**
   * Generate a payment link for an invoice.
   *
   * For OFFLINE → returns the guardian-portal URL where the parent can
   *               see bank details + upload proof.
   * For real    → calls the gateway's "create checkout session" API.
   *
   * @returns absolute URL + optional ISO expiry hint (gateways usually
   *          impose a 15–60 min link TTL).
   */
  createCheckoutLink(args: {
    tenantId: string;
    invoice: Invoice;
    /** Guardian portal token (used by OFFLINE to build the public URL). */
    guardianPortalToken: string;
    /** Base URL of the guardian web UI, from app.config.webBaseUrl. */
    webBaseUrl: string;
  }): Promise<{ url: string; expiresAt?: Date }>;

  /**
   * Verify a webhook payload's signature. Called BEFORE parsing.
   *
   * @returns true when the signature matches; false to reject the call.
   */
  verifyWebhookSignature(args: {
    payload: unknown;
    headers: Record<string, string>;
    rawBody?: string;
  }): boolean;

  /**
   * Translate a verified webhook payload into a normalised result the
   * PaymentsService can apply. Implementations should NOT mutate any
   * DB rows directly — that's the caller's responsibility.
   *
   * Throw to indicate the payload is malformed AFTER signature passed
   * (very unlikely with a real gateway, but possible if the payload
   * shape changed and our parser is stale).
   */
  parseWebhookEvent(args: {
    payload: unknown;
    headers: Record<string, string>;
  }): {
    /** Gateway's own reference / transaction ID. Used to de-dup. */
    gatewayRef: string;
    /** Our enrolment ID, recovered from gateway metadata. */
    enrolmentId: string;
    /** Our invoice ID, when the payment was for a specific instalment. */
    invoiceId?: string | null;
    /** Tenant ID, recovered from gateway metadata. */
    tenantId: string;
    /** Final outcome — only COMPLETED or FAILED reach our DB; pending events are ignored. */
    /**
     * Final outcome the gateway is reporting.
     * Use string literals — Prisma enums are runtime consts and can't
     * be namespace-accessed in type positions.
     */
    status: 'COMPLETED' | 'FAILED';
    method: PaymentMethod;
    amount: number;
    /** Gateway-provided unique event ID — used as our idempotency key. */
    idempotencyKey: string;
    failureReason?: string;
  };
}
