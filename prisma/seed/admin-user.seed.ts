import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seedAdminUsers(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const admins = [
    {
      email: 'superadmin@neomora.com',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      tenantId: 'tenant-1-id', // Scoped to first tenant for default context
    },
    {
      email: 'manager@elitesports.com',
      passwordHash,
      role: UserRole.LOCATION_MANAGER,
      tenantId: 'tenant-2-id',
    },
  ];

  for (const admin of admins) {
    await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: admin.tenantId,
          email: admin.email,
        },
      },
      update: {},
      create: admin,
    });
  }

  console.log('✅ Admin users seeded');
}
