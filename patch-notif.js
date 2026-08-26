const fs = require('fs');
const file = 'src/modules/notifications/notifications.service.ts';
let code = fs.readFileSync(file, 'utf8');

const rejectCode = `  async enqueueRegistrationRejected(input: {
    tenantId: string;
    participantId: string;
    participantName: string;
    participantLang: string;
    guardian: { id: string; fullName: string; phone: string; email: string };
    reason: string;
  }): Promise<void> {
    try {
      const lang = input.participantLang === 'ar' ? 'ar' : 'en';
      const body = renderTemplate('REGISTRATION_REJECTED', lang, {
        guardianName: input.guardian.fullName,
        participantName: input.participantName,
        reason: input.reason,
      });

      // Always force EMAIL channel for registration reject
      const channel = 'EMAIL';
      const recipientStr = input.guardian.email;

      await this.prisma.notification.create({
        data: {
          tenantId: input.tenantId,
          participantId: input.participantId,
          recipientGuardianId: input.guardian.id,
          type: 'REGISTRATION_OUTCOME',
          channel: 'EMAIL',
          recipientStr,
          subject: lang === 'ar' ? 'تحديث بشأن طلب التسجيل' : 'Update on your Registration Request',
          body,
          status: 'QUEUED',
        },
      });
    } catch (err) {
      this.logger.error(\`Failed to enqueue rejection for participant=\${input.participantId}\`, err);
    }
  }
`;

code = code.replace(
  "async enqueueRegistrationOutcome",
  rejectCode + "\n  async enqueueRegistrationOutcome"
);

fs.writeFileSync(file, code);
