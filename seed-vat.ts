import { PrismaService } from './src/infra/database/prisma.service.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const t = await prisma.tenant.findFirst();
  if(!t) { console.log('no tenant'); return; }
  await prisma.vatRate.create({
    data: { tenantId: t.id, rate: 13, effectiveFrom: new Date('2020-01-01') }
  });
  console.log('Seeded VAT 13% for ' + t.id);
  await prisma.onModuleDestroy();
}
main();
