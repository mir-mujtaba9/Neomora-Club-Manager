import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type { Prisma, Enrolment, Waitlist } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import type { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';

export type AllocationOutcome = 'ENROLLED' | 'WAITLISTED';

export interface AllocateInput {
	tenantId: string;
	participantId: string;
	sessionId: string;
	locationId: string;
	paymentPlanType: PaymentPlanType;
	/** Set when this allocation is a re-enrolment; written to enrolment row. */
	reEnrolledFromId?: string;
}

export interface AllocateResult {
	outcome: AllocationOutcome;
	enrolment?: Enrolment;
	waitlist?: Waitlist;
}

/**
 * Single source of truth for "give the participant a seat OR put them on the waitlist".
 *
 *
 *
 *
 * Callers are responsible for:
 *   - Validating that the caller (user / public form) is allowed to act on
 *     this (tenant, session, location).
 *   - Rejecting duplicate registrations (same participant in same session+location).
 *   - Mapping the allocator's `outcome` / `enrolment` / `waitlist` to whatever
 *     response shape their controller already returns.
 *
 * The allocator itself validates:
 *   - Session exists and is not soft-deleted.
 *   - Session is offered at the given location (session_locations link).
 *   - Location exists and is not soft-deleted.
 */
@Injectable()
export class EnrolmentAllocatorService {
	constructor(private readonly prisma: PrismaService) {}

	async allocate(
		tx: Prisma.TransactionClient,
		input: AllocateInput,
	): Promise<AllocateResult> {
		const {
			tenantId,
			participantId,
			sessionId,
			locationId,
			paymentPlanType,
			reEnrolledFromId,
		} = input;

		// 1. Serialize parallel allocations for the same (session, location).
		//    hashtext() returns int4; pg_advisory_xact_lock has a two-int4 overload.
		//    Use $executeRaw (not $queryRaw) because pg_advisory_xact_lock returns
		//    void — $queryRaw would fail to deserialize a void column.
		await tx.$executeRaw`
			SELECT pg_advisory_xact_lock(hashtext(${sessionId}), hashtext(${locationId}))
		`;

		// 2. Load session + the per-location fee override (if any).
		const session = await tx.session.findFirst({
			where: { id: sessionId, tenantId, deletedAt: null },
			include: {
				sessionLocations: {
					where: { locationId },
					select: { feeOverride: true },
				},
			},
		});
		if (!session) {
			throw new NotFoundException('Session not found');
		}
		if (!session.sessionLocations || session.sessionLocations.length === 0) {
			throw new BadRequestException(
				'Session is not offered at the specified location',
			);
		}

		// 3. Load location capacity.
		const location = await tx.location.findFirst({
			where: { id: locationId, tenantId, deletedAt: null },
			select: { capacity: true },
		});
		if (!location) {
			throw new NotFoundException('Location not found');
		}

		const totalFee =
			session.sessionLocations[0]?.feeOverride ?? session.baseFee;

		// 4. Count current occupants. A row counts as "taking a seat" unless it
		//    is WAITLISTED (those live in the waitlist table anyway) or WITHDRAWN.
		const occupied = await tx.enrolment.count({
			where: {
				tenantId,
				sessionId,
				locationId,
				deletedAt: null,
				status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
			},
		});

		// 5a. Seat available → create enrolment at FEE_PENDING.
		if (occupied < location.capacity) {
			const enrolment = await tx.enrolment.create({
				data: {
					tenantId,
					participantId,
					sessionId,
					locationId,
					paymentPlanType: paymentPlanType as Prisma.EnrolmentCreateInput['paymentPlanType'],
					totalFee: totalFee as Prisma.Decimal,
					paidAmount: 0 as unknown as Prisma.Decimal,
					balance: totalFee as Prisma.Decimal,
					status: 'FEE_PENDING',
					...(reEnrolledFromId ? { reEnrolledFromId } : {}),
				},
			});
			return { outcome: 'ENROLLED', enrolment };
		}

		// 5b. At capacity → append to waitlist with MAX(position) + 1.
		//
		//     Using MAX rather than COUNT avoids a hole when a previously
		//     soft-deleted row leaves a gap. With the advisory lock above,
		//     this read-then-write is race-free; the partial unique index
		//     `waitlist_session_location_position_active_key` is a backstop.
		const last = await tx.waitlist.findFirst({
			where: { tenantId, sessionId, locationId, deletedAt: null },
			orderBy: { position: 'desc' },
			select: { position: true },
		});
		const nextPosition = (last?.position ?? 0) + 1;

		const waitlist = await tx.waitlist.create({
			data: {
				tenantId,
				participantId,
				sessionId,
				locationId,
				position: nextPosition,
			},
		});
		return { outcome: 'WAITLISTED', waitlist };
	}
}
