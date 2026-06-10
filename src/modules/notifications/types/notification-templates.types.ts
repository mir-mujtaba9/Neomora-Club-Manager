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
  | 'WAITLIST_OFFER';

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
}

export type SupportedLang = 'en' | 'ar';
