/**
 * Plan A smoke test — verifies the EnrolmentAllocatorService under concurrency.
 *
 * What it proves:
 *   1. Capacity is never exceeded under N parallel registrations.
 *   2. Tenant-scoped uniqueId generation never collides.
 *   3. Waitlist positions are 1..K with no duplicates and no gaps (FIFO integrity).
 *
 * Prerequisites:
 *   - The Nest server is running locally: `npm run start:dev`
 *   - DATABASE_URL in .env points at the same DB the server is using
 *   - `cm_tenant_counters` table exists (apply migration first)
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/smoke-test-allocator.ts
 *
 * Optional env vars:
 *   API_BASE_URL   default http://localhost:3000
 *   CAPACITY       default 3   (seats on the test session+location)
 *   PARALLEL       default 10  (simultaneous registrations to fire)
 *   KEEP_DATA      default 0   (set to 1 to skip cleanup for manual inspection)
 */

import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CAPACITY = Number(process.env.CAPACITY ?? 3);
const PARALLEL = Number(process.env.PARALLEL ?? 10);
const KEEP_DATA = process.env.KEEP_DATA === '1';

const RUN_TAG = Date.now().toString(36);
const TEST_SLUG = `smoke-${RUN_TAG}`;
const TEST_TENANT_ID = `smoke-tenant-${RUN_TAG}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(emoji: string, msg: string): void {
	// eslint-disable-next-line no-console
	console.log(`${emoji} ${msg}`);
}

function bail(msg: string): never {
	// eslint-disable-next-line no-console
	console.error(`\n❌ ${msg}\n`);
	process.exit(1);
}

function buildPrisma(): PrismaClient {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) bail('DATABASE_URL is not set');
	const adapter = new PrismaNeon({ connectionString });
	return new PrismaClient({ adapter });
}

// ─── Setup ───────────────────────────────────────────────────────────────────
async function setup(prisma: PrismaClient) {
	log('🌱', `Creating test tenant ${TEST_TENANT_ID}`);

	// Create a throw-away tenant. We do NOT touch existing tenants because
	// the tenant model is governed by the separate tenant-management repo.
	await prisma.tenant.create({
		data: {
			id: TEST_TENANT_ID,
			name: `Smoke Test ${RUN_TAG}`,
			slug: `smoke-${RUN_TAG}`,
			schemaName: `smoke_${RUN_TAG}`,
			defaultLang: 'en',
		},
	});

	log('🌱', `Creating location with capacity=${CAPACITY}, slug=${TEST_SLUG}`);
	const location = await prisma.location.create({
		data: {
			tenantId: TEST_TENANT_ID,
			name: `Smoke Location ${RUN_TAG}`,
			city: 'Test City',
			capacity: CAPACITY,
			status: 'active',
			registrationSlug: TEST_SLUG,
		},
	});

	log('🌱', `Creating OPEN session`);
	const session = await prisma.session.create({
		data: {
			tenantId: TEST_TENANT_ID,
			name: `Smoke Session ${RUN_TAG}`,
			startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			baseFee: '100.00',
			status: 'OPEN',
		},
	});

	log('🌱', `Linking session ↔ location`);
	await prisma.sessionLocation.create({
		data: { sessionId: session.id, locationId: location.id },
	});

	return { location, session };
}

// ─── Fire the parallel registrations ─────────────────────────────────────────
async function fireParallel(sessionId: string) {
	log('🚀', `Firing ${PARALLEL} parallel POSTs to /api/v1/register/${TEST_SLUG}`);

	const requests = Array.from({ length: PARALLEL }, (_, i) => {
		const body = {
			firstNameEn: `Tester${i}`,
			lastNameEn: `Race${RUN_TAG}`,
			dateOfBirth: '2015-01-01',
			gender: 'M',
			phone: `+96650000${String(i).padStart(4, '0')}`,
			sessionId,
			guardian: {
				fullName: `Parent ${i}`,
				relationship: 'parent',
				phone: `+96655555${String(i).padStart(4, '0')}`,
			},
		};
		return fetch(`${API_BASE_URL}/api/v1/register/${TEST_SLUG}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}).then(async (r) => ({
			status: r.status,
			body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
		}));
	});

	const settled = await Promise.allSettled(requests);
	return settled.map((s, idx) =>
		s.status === 'fulfilled'
			? { idx, ok: true as const, ...s.value }
			: { idx, ok: false as const, error: String(s.reason) },
	);
}

// ─── Assertions ──────────────────────────────────────────────────────────────
interface ResultRow {
	idx: number;
	ok: boolean;
	status?: number;
	body?: Record<string, unknown>;
	error?: string;
}

function assertResults(results: ResultRow[]) {
	const failed = results.filter((r) => !r.ok || r.status !== 201);
	if (failed.length > 0) {
		// eslint-disable-next-line no-console
		console.error('Failed responses:', JSON.stringify(failed, null, 2));
		bail(`${failed.length}/${PARALLEL} requests did not return 201`);
	}

	const bodies = results.map((r) => r.body!);

	// 1. uniqueId uniqueness
	const uniqueIds = bodies.map((b) => b.uniqueId as string);
	const distinctIds = new Set(uniqueIds);
	if (distinctIds.size !== uniqueIds.length) {
		bail(
			`uniqueId collision detected: ${uniqueIds.length} requests produced ${distinctIds.size} distinct IDs`,
		);
	}
	log('✅', `uniqueId integrity: ${uniqueIds.length} requests → ${distinctIds.size} distinct IDs`);

	// 2. Capacity enforcement
	const enrolled = bodies.filter((b) => b.enrolmentStatus === 'ENROLLED');
	const waitlisted = bodies.filter((b) => b.enrolmentStatus === 'WAITLISTED');

	if (enrolled.length !== CAPACITY) {
		bail(
			`Capacity violation: expected exactly ${CAPACITY} ENROLLED, got ${enrolled.length}`,
		);
	}
	if (waitlisted.length !== PARALLEL - CAPACITY) {
		bail(
			`Waitlist count mismatch: expected ${PARALLEL - CAPACITY} WAITLISTED, got ${waitlisted.length}`,
		);
	}
	log(
		'✅',
		`Capacity enforced: ${enrolled.length} ENROLLED, ${waitlisted.length} WAITLISTED`,
	);

	// 3. Waitlist position integrity (1..K with no gaps or dupes)
	const positions = waitlisted
		.map((b) => b.waitlistPosition as number)
		.sort((a, b) => a - b);
	const expected = Array.from(
		{ length: PARALLEL - CAPACITY },
		(_, i) => i + 1,
	);
	const positionsMatch =
		positions.length === expected.length &&
		positions.every((p, i) => p === expected[i]);
	if (!positionsMatch) {
		bail(
			`Waitlist position integrity broken. Got [${positions.join(', ')}], expected [${expected.join(', ')}]`,
		);
	}
	log('✅', `Waitlist positions: [${positions.join(', ')}]`);
}

// ─── Verify allocator side-effects in DB ─────────────────────────────────────
async function assertDbState(
	prisma: PrismaClient,
	sessionId: string,
	locationId: string,
) {
	// Confirm cm_tenant_counters advanced exactly PARALLEL steps for this tenant.
	const counter = await prisma.cmTenantCounter.findUnique({
		where: {
			tenantId_counterKey: {
				tenantId: TEST_TENANT_ID,
				counterKey: 'participant',
			},
		},
	});
	if (!counter || counter.nextValue !== PARALLEL) {
		bail(
			`cm_tenant_counters.next_value = ${counter?.nextValue ?? 'NULL'}, expected ${PARALLEL}`,
		);
	}
	log('✅', `cm_tenant_counters.next_value = ${counter.nextValue}`);

	// Confirm enrolment count in DB matches CAPACITY (not 4, not 2).
	const enrolmentCount = await prisma.enrolment.count({
		where: { tenantId: TEST_TENANT_ID, sessionId, locationId, deletedAt: null },
	});
	if (enrolmentCount !== CAPACITY) {
		bail(`DB enrolment count = ${enrolmentCount}, expected ${CAPACITY}`);
	}
	log('✅', `DB enrolment count = ${enrolmentCount}`);

	// Confirm waitlist count and that no two rows share a position
	// (the partial unique index would have thrown if they did, but double-check).
	const waitlistRows = await prisma.waitlist.findMany({
		where: { tenantId: TEST_TENANT_ID, sessionId, locationId, deletedAt: null },
		select: { position: true },
		orderBy: { position: 'asc' },
	});
	const distinctPositions = new Set(waitlistRows.map((r) => r.position));
	if (
		waitlistRows.length !== PARALLEL - CAPACITY ||
		distinctPositions.size !== waitlistRows.length
	) {
		bail(
			`DB waitlist integrity broken: rows=${waitlistRows.length}, distinct=${distinctPositions.size}`,
		);
	}
	log('✅', `DB waitlist rows = ${waitlistRows.length}, all positions distinct`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
async function cleanup(prisma: PrismaClient) {
	if (KEEP_DATA) {
		log('🛟', 'KEEP_DATA=1 → skipping cleanup. Inspect manually then drop the smoke- rows.');
		return;
	}
	log('🧹', 'Cleaning up test data');
	// Hard-delete in FK order. Test data, throwaway tenant, no audit value.
	await prisma.$transaction([
		prisma.notification.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.waitlist.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.enrolment.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.guardian.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.participant.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.sessionLocation.deleteMany({
			where: { session: { tenantId: TEST_TENANT_ID } },
		}),
		prisma.session.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.location.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.cmTenantCounter.deleteMany({ where: { tenantId: TEST_TENANT_ID } }),
		prisma.tenant.deleteMany({ where: { id: TEST_TENANT_ID } }),
	]);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
	// eslint-disable-next-line no-console
	console.log(`\n🧪 Allocator smoke test — run tag: ${RUN_TAG}\n`);

	// Confirm the API is reachable before we set up anything.
	try {
		await fetch(`${API_BASE_URL}/api/docs`, { method: 'GET' });
	} catch (err) {
		bail(
			`API unreachable at ${API_BASE_URL}. Start the server with 'npm run start:dev' first. (${(err as Error).message})`,
		);
	}

	const prisma = buildPrisma();
	let setupOk = false;
	try {
		const { location, session } = await setup(prisma);
		setupOk = true;

		const results = await fireParallel(session.id);
		assertResults(results);
		await assertDbState(prisma, session.id, location.id);

		log('🎉', 'All allocator invariants hold under concurrency.');
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exitCode = 1;
	} finally {
		if (setupOk) await cleanup(prisma);
		await prisma.$disconnect();
	}
}

void main();
