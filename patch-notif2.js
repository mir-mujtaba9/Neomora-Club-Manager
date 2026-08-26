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

      await this.enqueueAndDispatch({
        tenantId: input.tenantId,
        participantId: input.participantId,
        type: NotificationType.REGISTRATION_CONFIRM,
        channel: NotificationChannel.EMAIL,
        recipientEmail: input.guardian.email,
        bodyText: body,
      });
    } catch (err) {
      this.logger.error(\`Failed to enqueue rejection for participant=\${input.participantId}\`, err);
    }
  }
`;

code = code.replace(
  /async enqueueRegistrationRejected[\s\S]*?async enqueueRegistrationOutcome/,
  rejectCode + "\n  async enqueueRegistrationOutcome"
);

fs.writeFileSync(file, code);
