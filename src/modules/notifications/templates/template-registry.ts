import type {
  SupportedLang,
  TemplateKey,
  TemplateVarsByKey,
} from '../types/notification-templates.types.js';

/**
 * Renderer signature for a single (template, lang) combination.
 * Returns the fully rendered, ready-to-send body text.
 */
type Renderer<K extends TemplateKey> = (vars: TemplateVarsByKey[K]) => string;

/**
 * Template registry. Each entry maps a TemplateKey to a record of
 * (lang -> renderer). Adding a new lang means appending an entry to
 * the inner record — no other code changes required.
 *
 * Why a code-based registry instead of DB rows?
 *   - We control message content; no tenant should be able to edit
 *     templates and inadvertently break payment/legal copy.
 *   - Compile-time enforcement of required variables.
 *   - Easy to grep / diff in PR review.
 *
 * If client later wants per-tenant overrides, add an override layer
 * here that checks a `cm_notification_template_overrides` table first.
 */
const REGISTRY: {
  [K in TemplateKey]: Record<SupportedLang, Renderer<K>>;
} = {
  REGISTRATION_ENROLLED: {
    en: (v) =>
      `Hi ${v.guardianName}, ${v.participantName}'s registration for ${v.sessionName} at ${v.locationName} is confirmed. Unique ID: ${v.uniqueId}. Please complete the fee payment to secure the spot.`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، تم تأكيد تسجيل ${v.participantName} في ${v.sessionName} بفرع ${v.locationName}. الرقم التعريفي: ${v.uniqueId}. يرجى إكمال دفع الرسوم لتثبيت الحجز.`,
  },
  REGISTRATION_WAITLISTED: {
    en: (v) =>
      `Hi ${v.guardianName}, ${v.participantName} has been added to the waitlist for ${v.sessionName} at ${v.locationName} (position #${v.position}). Unique ID: ${v.uniqueId}. We will notify you the moment a seat opens.`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، تمت إضافة ${v.participantName} إلى قائمة الانتظار لـ ${v.sessionName} بفرع ${v.locationName} (المركز #${v.position}). الرقم التعريفي: ${v.uniqueId}. سنبلغكم فور توفر مقعد.`,
  },
  REGISTRATION_INQUIRY: {
    en: (v) =>
      `Hi ${v.guardianName}, thank you for registering ${v.participantName} at ${v.locationName}. Unique ID: ${v.uniqueId}. A staff member will contact you to help select a session.`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، شكراً لتسجيل ${v.participantName} في فرع ${v.locationName}. الرقم التعريفي: ${v.uniqueId}. سيتواصل معكم أحد الموظفين لمساعدتكم في اختيار الدورة.`,
  },
  STAFF_ALERT_NEW_INQUIRY: {
    en: (v) =>
      `New ${v.outcome.toLowerCase()} registration: ${v.participantName} (ID: ${v.uniqueId}) at ${v.locationName}. Guardian: ${v.guardianName} (${v.guardianPhone}).`,
    ar: (v) =>
      `تسجيل جديد (${v.outcome}): ${v.participantName} (الرقم: ${v.uniqueId}) في فرع ${v.locationName}. ولي الأمر: ${v.guardianName} (${v.guardianPhone}).`,
  },
  WAITLIST_OFFER: {
    en: (v) =>
      `Hi ${v.guardianName}, a seat is now available for ${v.participantName} in ${v.sessionName} at ${v.locationName}. Please accept or decline before ${v.expiresAt}.\n\nAccept: ${v.acceptUrl}\nDecline: ${v.declineUrl}`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، يتوفر الآن مقعد لـ ${v.participantName} في ${v.sessionName} بفرع ${v.locationName}. يرجى القبول أو الرفض قبل ${v.expiresAt}.\n\nقبول: ${v.acceptUrl}\nرفض: ${v.declineUrl}`,
  },
  FEE_INVOICE: {
    en: (v) =>
      `Hi ${v.guardianName}, invoice ${v.invoiceNumber} for ${v.participantName}'s ${v.sessionName} is now available. Amount: ${v.amount}. Due: ${v.dueDate}.\n\nPay here: ${v.paymentUrl}`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، الفاتورة ${v.invoiceNumber} لـ ${v.participantName} في ${v.sessionName} متاحة الآن. المبلغ: ${v.amount}. تاريخ الاستحقاق: ${v.dueDate}.\n\nللدفع: ${v.paymentUrl}`,
  },
  PAYMENT_REMINDER: {
    en: (v) => {
      const when =
        v.daysUntilDue > 0
          ? `due in ${v.daysUntilDue} day${v.daysUntilDue === 1 ? '' : 's'}`
          : v.daysUntilDue === 0
            ? 'due today'
            : `overdue by ${Math.abs(v.daysUntilDue)} day${Math.abs(v.daysUntilDue) === 1 ? '' : 's'}`;
      return `Hi ${v.guardianName}, reminder: invoice ${v.invoiceNumber} for ${v.participantName} (${v.amount}) is ${when}.\n\nPay here: ${v.paymentUrl}`;
    },
    ar: (v) => {
      const when =
        v.daysUntilDue > 0
          ? `مستحقة خلال ${v.daysUntilDue} يوم`
          : v.daysUntilDue === 0
            ? 'مستحقة اليوم'
            : `متأخرة بـ ${Math.abs(v.daysUntilDue)} يوم`;
      return `مرحباً ${v.guardianName}، تذكير: الفاتورة ${v.invoiceNumber} لـ ${v.participantName} (${v.amount}) ${when}.\n\nللدفع: ${v.paymentUrl}`;
    },
  },
  PAYMENT_CONFIRM: {
    en: (v) =>
      v.receiptUrl
        ? `Hi ${v.guardianName}, we've received your payment of ${v.amount} for ${v.participantName} via ${v.paymentMethod}. Receipt: ${v.receiptUrl}`
        : `Hi ${v.guardianName}, we've received your payment of ${v.amount} for ${v.participantName} via ${v.paymentMethod}. Your receipt will be available shortly.`,
    ar: (v) =>
      v.receiptUrl
        ? `مرحباً ${v.guardianName}، تم استلام دفعتكم بمبلغ ${v.amount} لـ ${v.participantName} عبر ${v.paymentMethod}. الإيصال: ${v.receiptUrl}`
        : `مرحباً ${v.guardianName}، تم استلام دفعتكم بمبلغ ${v.amount} لـ ${v.participantName} عبر ${v.paymentMethod}. سيكون الإيصال متاحاً قريباً.`,
  },
  GUARDIAN_MAGIC_LINK: {
    en: (v) =>
      `Hi ${v.guardianName}, here is your secure portal link (valid for ${v.expiresIn}):\n${v.magicLinkUrl}\n\nIf you did not request this, please ignore this message.`,
    ar: (v) =>
      `مرحباً ${v.guardianName}، إليك رابط بوابة ولي الأمر الآمن (صالح لمدة ${v.expiresIn}):\n${v.magicLinkUrl}\n\nإذا لم تطلب هذا، فضلاً تجاهل هذه الرسالة.`,
  },
};

/**
 * Render a template for the given key + lang. Falls back to English
 * if the requested lang is missing (defensive — registry is fully
 * populated for all SupportedLang values).
 */
export function renderTemplate<K extends TemplateKey>(
  key: K,
  lang: string,
  vars: TemplateVarsByKey[K],
): string {
  const renderers = REGISTRY[key];
  const renderer =
    (renderers as Record<string, Renderer<K>>)[lang] ?? renderers.en;
  return renderer(vars);
}
