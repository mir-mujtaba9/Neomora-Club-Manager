import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { role: 'PARENT' }, include: { guardians: { include: { participant: true } } } });
  console.dir(users.map(u => ({ email: u.email, guardiansCount: u.guardians.length, participants: u.guardians.map(g => g.participant.firstNameEn) })), { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
