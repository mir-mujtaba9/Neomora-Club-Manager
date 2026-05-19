import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { seedTenants } from './tenant.seed';
import { seedAdminUsers } from './admin-user.seed';
import 'dotenv/config';

async function main() {
  console.log('🌱 Starting database seed with Neon Adapter...');
  
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedTenants(prisma);
    await seedAdminUsers(prisma);
    console.log('🏁 Seeding completed successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();