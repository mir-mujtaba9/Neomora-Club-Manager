import { PrismaClient, TenantStatus, TenantPlan } from '@prisma/client';

export async function seedTenants(prisma: PrismaClient) {
  const tenants = [
    {
      id: 'tenant-1-id',
      name: 'Neomora Main Club',
      slug: 'neomora-main',
      schemaName: 'tenant_neomora_main',
      plan: TenantPlan.ENTERPRISE,
      status: TenantStatus.ACTIVE,
      defaultLang: 'en',
    },
    {
      id: 'tenant-2-id',
      name: 'Elite Sports Riyadh',
      slug: 'elite-riyadh',
      schemaName: 'tenant_elite_riyadh',
      plan: TenantPlan.GROWTH,
      status: TenantStatus.ACTIVE,
      defaultLang: 'ar',
    },
  ];

  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { slug: tenant.slug },
      update: {},
      create: tenant,
    });
  }

  console.log('✅ Tenants seeded');
}
