const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.tenant.findFirst();
  if(!t) { console.log('no tenant'); return; }
  await prisma.vatRate.create({
    data: { tenantId: t.id, rate: 13, effectiveFrom: new Date('2020-01-01') }
  });
  console.log('Seeded VAT 13% for ' + t.id);
}
main();
