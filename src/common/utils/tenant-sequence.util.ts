import type { Prisma } from '@prisma/client';

/**
 * Atomically reserve the next sequence value for the given tenant + counter.
 *
 * Backed by an UPSERT against `cm_tenant_counters`. Because the conflict
 * branch is `next_value = next_value + 1` and Postgres takes a row-level
 * lock during ON CONFLICT DO UPDATE, two concurrent calls for the same
 * (tenant_id, counter_key) are serialized — collisions are impossible.
 *
 * MUST be called inside a Prisma `$transaction` so that the reserved value
 * is rolled back when the surrounding transaction aborts. Failing to do so
 * would burn IDs on every aborted registration.
 *
 * @param tx          Prisma transaction client
 * @param tenantId    Tenant scope for the counter
 * @param counterKey  Logical name of the counter (e.g. 'participant')
 * @returns           The next integer value in the sequence (>= 1)
 */
export async function nextTenantSequence(
	tx: Prisma.TransactionClient,
	tenantId: string,
	counterKey: string,
): Promise<number> {
	const rows = await tx.$queryRaw<Array<{ next_value: number | bigint }>>`
		INSERT INTO "cm_tenant_counters" ("tenant_id", "counter_key", "next_value")
		VALUES (${tenantId}, ${counterKey}, 1)
		ON CONFLICT ("tenant_id", "counter_key")
		DO UPDATE SET "next_value" = "cm_tenant_counters"."next_value" + 1
		RETURNING "next_value"
	`;

	const raw = rows?.[0]?.next_value;
	if (raw === null || raw === undefined) {
		throw new Error(
			`Failed to reserve sequence value for tenant=${tenantId} key=${counterKey}`,
		);
	}
	// Postgres `integer` may come back as either number or bigint depending on
	// the driver / adapter. Normalize to a finite number; counter values are
	// well within the safe integer range.
	const value = typeof raw === 'bigint' ? Number(raw) : raw;
	if (!Number.isFinite(value)) {
		throw new Error(
			`Sequence value for tenant=${tenantId} key=${counterKey} is not a finite number (got ${String(raw)})`,
		);
	}
	return value;
}
