const fs = require('fs');
const file = 'src/modules/participants/participants.service.ts';
let code = fs.readFileSync(file, 'utf8');

const hookCode = `		const updated = await this.prisma.participant.update({ where: { id: participant.id }, data: { status: dto.status as any } });

		// Trigger rejection email if public request is withdrawn
		if (current === 'INQUIRY' && next === 'WITHDRAWN') {
			const guardian = await this.prisma.guardian.findFirst({
				where: { participantId: id, deletedAt: null },
			});
			if (guardian && guardian.email) {
				await this.notifications.enqueueRegistrationRejected({
					tenantId,
					participantId: id,
					participantName: \`\${updated.firstNameEn} \${updated.lastNameEn}\`,
					participantLang: 'en',
					guardian: {
						id: guardian.id,
						fullName: guardian.fullName,
						phone: guardian.phone || '',
						email: guardian.email,
					},
					reason: dto.reason || 'No reason provided',
				});
			}
		}`;

code = code.replace(
  "const updated = await this.prisma.participant.update({ where: { id: participant.id }, data: { status: dto.status as any } });",
  hookCode
);

fs.writeFileSync(file, code);
