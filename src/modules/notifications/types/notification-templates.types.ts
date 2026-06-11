/**
 * Template registry keys. Each key maps to one or more lang-specific
 * renderers in `templates/template-registry.ts`.
 *
 * Adding a new template:
 *   1. Add a key here (and to the `TemplateVars` type below).
 *   2. Add a renderer for each supported lang in template-registry.ts.
 *   3. Optionally map it to a NotificationType in `notifications.service.ts`.
 */
export type TemplateKey =
  | 'REGISTRATION_ENROLLED'
  | 'REGISTRATION_WAITLISTED'
  | 'REGISTRATION_INQUIRY'
  | 'STAFF_ALERT_NEW_INQUIRY'
  | 'WAITLIST_OFFER'
  | 'FEE_INVOICE'
  | 'PAYMENT_REMINDER'
  | 'PAYMENT_CONFIRM'
  | 'GUARDIAN_MAGIC_LINK'
  | 'PASSWORD_RESET';

/**
 * Shape of variables expected by each template. Renderers receive this
 * directly so a missing var is a TypeScript error, not a runtime "{name}"
 * string in a sent message.
 */
export interface TemplateVarsByKey {
  REGISTRATION_ENROLLED: {
    guardianName: string;
    participantName: string;
    sessionName: string;
    locationName: string;
    uniqueId: string;
  };
  REGISTRATION_WAITLISTED: {
    guardianName: string;
    participantName: string;
    sessionName: string;
    locationName: string;
    uniqueId: string;
    position: number;
  };
  REGISTRATION_INQUIRY: {
    guardianName: string;
    participantName: string;
    locationName: string;
    uniqueId: string;
  };
  STAFF_ALERT_NEW_INQUIRY: {
    participantName: string;
    uniqueId: string;
    locationName: string;
    guardianName: string;
    guardianPhone: string;
    outcome: 'ENROLLED' | 'WAITLISTED' | 'INQUIRY';
  };
  WAITLIST_OFFER: {
    guardianName: string;
    participantName: string;
    sessionName: string;
    locationName: string;
    /** ISO-formatted local-time string suitable for direct inclusion in the body. */
    expiresAt: string;
    acceptUrl: string;
    declineUrl: string;
  };
  /**
   * Sent when a new invoice is generated (or re-issued). Contains a
   * checkout / portal link for the parent to pay.
   */
  FEE_INVOICE: {
    guardianName: string;
    participantName: string;
    sessionName: string;
    invoiceNumber: string;
    /** Formatted with currency, e.g. "SAR 1,500.00". */
    amount: string;
    /** ISO yyyy-mm-dd. */
    dueDate: string;
    /** Gateway checkout URL or portal-pay URL. */
    paymentUrl: string;
  };
  /**
   * Reminder sent N days before an invoice's due date (or after when
   * overdue). `daysUntilDue` is negative for overdue invoices.
   */
  PAYMENT_REMINDER: {
    guardianName: string;
    participantName: string;
    invoiceNumber: string;
    amount: string;
    dueDate: string;
    /** Positive = upcoming. Zero = today. Negative = overdue. */
    daysUntilDue: number;
    paymentUrl: string;
  };
  /**
   * Confirmation sent after a payment is verified (offline) or
   * gateway-completed. Includes the receipt URL when the PDF has
   * already been generated; falls back to an empty string when the
   * receipt is queued but not yet ready.
   */
  PAYMENT_CONFIRM: {
    guardianName: string;
    participantName: string;
    amount: string;
    paymentMethod: string;
    /** Empty string when receipt is pending. */
    receiptUrl: string;
  };
  /**
   * Sent when a guardian requests a portal magic link. Contains a
   * single-use URL valid for ~15 minutes. The guardian's
   * NotificationsService caller is responsible for shortening the URL
   * if the channel imposes character limits.
   */
  GUARDIAN_MAGIC_LINK: {
    guardianName: string;
    magicLinkUrl: string;
    /** Human-friendly TTL hint, e.g. "15 minutes". */
    expiresIn: string;
  };
  /**
   * Plan J (F-33) — staff/admin password-reset email. The link is a
   * single-use token endpoint that lands on the web app's reset page.
   */
  PASSWORD_RESET: {
    userName: string;
    resetUrl: string;
    /** Human-friendly TTL hint, e.g. "1 hour". */
    expiresIn: string;
  };
}

export type SupportedLang = 'en' | 'ar';
