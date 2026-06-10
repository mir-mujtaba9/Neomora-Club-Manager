import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { RegisterParticipantDto } from './dto/register-participant.dto.js';
import { generateUniqueId } from '../../common/utils/unique-id.util.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';
import { EnrolmentAllocatorService } from '../enrolments/enrolment-allocator.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FindParticipantsDto } from './dto/find-participants.dto.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';
import { UpdateParticipantStatusDto } from './dto/update-participant-status.dto.js';
import { CreateStaffNoteDto } from './dto/create-staff-note.dto.js';

@Injectable()
export class ParticipantsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly allocator: EnrolmentAllocatorService,
		private readonly notifications: NotificationsService,
	) {}

	async register(dto: RegisterParticipantDto) {
		const slug = dto.locationSlug;

		const location = await this.prisma.location.findUnique({
			where: { registrationSlug: slug },
		});

		if (!location || location.deletedAt || location.status !== 'active') {
			throw new NotFoundException('Location not found or inactive');
		}

		const tenantId = location.tenantId;

		const dob = new Date(dto.dateOfBirth);
		if (isNaN(dob.getTime())) throw new BadRequestException('Invalid dateOfBirth');

		// Look up the session name BEFORE the tx so the post-commit notification
		// can reference it without an extra round-trip. Unlike the public form,
		// the staff-facing endpoint does NOT enforce session.status='OPEN' —
		// staff are trusted to enrol into any non-deleted session.
		let sessionName: string | null = null;
		if (dto.sessionId) {
			const session = await this.prisma.session.findFirst({
				where: { id: dto.sessionId, tenantId, deletedAt: null },
				select: { name: true },
			});
			sessionName = session?.name ?? null;
		}

		const result = await this.prisma.$transaction(async (tx) => {
			// Atomic tenant-scoped sequence replaces the previous `count + 1`
			// pattern, which could collide under parallel registrations.
			const seq = await nextTenantSequence(tx, tenantId, 'participant');
			const uniqueId = generateUniqueId('P', seq);

			const participant = await tx.participant.create({
				data: {
					tenantId,
					locationId: location.id,
					uniqueId,
					firstNameEn: dto.firstNameEn,
					firstNameAr: dto.firstNameAr ?? null,
					lastNameEn: dto.lastNameEn,
					lastNameAr: dto.lastNameAr ?? null,
					dateOfBirth: dob,
					gender: dto.gender,
					nationality: dto.nationality ?? null,
					phone: dto.phone,
					email: null,
					preferredLang: dto.preferredLang ?? 'en',
				},
			});

			const guardian = await tx.guardian.create({
				data: {
					tenantId,
					participantId: participant.id,
					fullName: dto.guardian.fullName,
					relationship: dto.guardian.relationship,
					phone: dto.guardian.phone,
					email: dto.guardian.email ?? null,
				},
			});

			let enrolment: any = null;
			let waitlistEntry: any = null;

			if (dto.sessionId) {
				// Capacity check + enrolment/waitlist creation is delegated to the
				// allocator to eliminate the previous race condition (parallel
				// requests could both see `occupied < capacity` and overbook).
				const allocation = await this.allocator.allocate(tx, {
					tenantId,
					participantId: participant.id,
					sessionId: dto.sessionId,
					locationId: location.id,
					paymentPlanType: PaymentPlanType.FULL,
				});

				if (allocation.outcome === 'ENROLLED') {
					enrolment = allocation.enrolment;
				} else {
					waitlistEntry = allocation.waitlist;
				}
			}

			return { participant, guardian, enrolment, waitlist: waitlistEntry };
		}, {
			// Concurrent registrations into the same (session, location) serialize
			// on the advisory lock inside the allocator. Default 5s tx timeout
			// would kill tail-end waiters under N>3 parallelism on Neon.
			timeout: 60000,
			maxWait: 60000,
		});

		// Fire confirmation + staff alerts AFTER commit. Fire-and-forget —
		// the notifications service handles its own errors and never throws.
		void this.notifications.enqueueRegistrationOutcome({
			tenantId,
			participantId: result.participant.id,
			enrolmentId: result.enrolment?.id ?? null,
			outcome: result.enrolment
				? 'ENROLLED'
				: result.waitlist
					? 'WAITLISTED'
					: 'INQUIRY',
			waitlistPosition: result.waitlist?.position,
			participantName: `${result.participant.firstNameEn} ${result.participant.lastNameEn}`,
			participantLang: result.participant.preferredLang,
			uniqueId: result.participant.uniqueId,
			sessionName,
			locationId: location.id,
			locationName: location.name,
			guardian: {
				fullName: result.guardian.fullName,
				phone: result.guardian.phone,
				email: result.guardian.email,
			},
		});

		return result;
	}

	async findAll(tenantId: string, user: any, query: FindParticipantsDto) {
		const { status, locationId, sessionId, search, page = 1, limit = 20, sortBy = 'createdAt', order = 'desc' } = query;
		const skip = (page - 1) * limit;

		const where: any = { tenantId, deletedAt: null };
		if (status) where.status = status;
		if (locationId) where.locationId = locationId;

		if (sessionId) {
			where.enrolments = { some: { sessionId } };
		}

		if (search) {
			where.OR = [
				{ firstNameEn: { contains: search, mode: 'insensitive' } },
				{ lastNameEn: { contains: search, mode: 'insensitive' } },
				{ uniqueId: { contains: search, mode: 'insensitive' } },
				{ phone: { contains: search, mode: 'insensitive' } },
			];
		}

		// Role-based filtering: location manager only sees own location
		if (user?.role === UserRole.LOCATION_MANAGER && user.locationId) {
			where.locationId = user.locationId;
		}

		const [items, total] = await Promise.all([
			this.prisma.participant.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
				include: {
					location: { select: { id: true, name: true, city: true } },
				},
			}),
			this.prisma.participant.count({ where }),
		]);

		return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
	}

	async findById(tenantId: string, user: any, id: string) {
		const participant = await this.prisma.participant.findFirst({
			where: { id, tenantId, deletedAt: null },
			include: {
				location: true,
				guardians: true,
				enrolments: { include: { session: true, location: true, invoices: true, payments: true } },
				documents: true,
				staffNotes: true,
			},
		});

		if (!participant) throw new NotFoundException('Participant not found');

		// Gather payments across enrolments
		const payments = await this.prisma.payment.findMany({
			where: { enrolment: { participantId: id } },
		});

		const response: any = {
			participant: { ...participant },
			guardians: participant.guardians || [],
			enrolments: participant.enrolments || [],
			documents: participant.documents || [],
			payments: payments || [],
		};

		// staffNotes visibility: only users with staff roles (non-guardian) can see
		const staffRoles = [
			UserRole.SUPER_ADMIN,
			UserRole.LOCATION_MANAGER,
			UserRole.FINANCE_OFFICER,
			UserRole.STAFF,
		];

		if (user && staffRoles.includes(user.role)) {
			response.staffNotes = participant.staffNotes || [];
		} else {
			response.staffNotes = [];
		}

		// Remove relations from participant payload (they are provided separately)
		delete response.participant.guardians;
		delete response.participant.enrolments;
		delete response.participant.documents;
		delete response.participant.payments;
		delete response.participant.staffNotes;

		return response;
	}

	async updateStatus(tenantId: string, id: string, user: any, dto: UpdateParticipantStatusDto) {
		const participant = await this.prisma.participant.findFirst({ where: { id, tenantId, deletedAt: null } });
		if (!participant) throw new NotFoundException('Participant not found');

		// Location manager can only update participants in their location
		if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== participant.locationId) {
			throw new BadRequestException('Not allowed to update participant in different location');
		}

		const current = participant.status as unknown as string;
		const next = dto.status as unknown as string;

		const allowedTransitions: Record<string, string[]> = {
			INQUIRY: ['DOCUMENTS_PENDING'],
			DOCUMENTS_PENDING: ['FEE_PENDING'],
			FEE_PENDING: ['ACTIVE'],
			ACTIVE: ['ON_HOLD', 'COMPLETED', 'WITHDRAWN'],
			ON_HOLD: [],
			COMPLETED: [],
			WITHDRAWN: [],
		};

		const allowed = allowedTransitions[current] || [];
		if (!allowed.includes(next)) {
			throw new BadRequestException(`Invalid status transition from ${current} to ${next}`);
		}

		const updated = await this.prisma.participant.update({ where: { id: participant.id }, data: { status: dto.status as any } });

		if (dto.reason && user && user.id) {
			await this.prisma.staffNote.create({ data: { tenantId, participantId: participant.id, authorId: user.id, note: dto.reason } });
		}

		return updated;
	}

	async addStaffNote(tenantId: string, participantId: string, user: any, dto: CreateStaffNoteDto) {
		const participant = await this.prisma.participant.findFirst({ where: { id: participantId, tenantId, deletedAt: null } });
		if (!participant) throw new NotFoundException('Participant not found');

		// permission check: location manager only for their location
		if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== participant.locationId) {
			throw new BadRequestException('Not allowed to add note for participant in different location');
		}

		const note = await this.prisma.staffNote.create({ data: { tenantId, participantId: participant.id, authorId: user.id, note: dto.note } });
		return note;
	}

	async getPortalByToken(token: string) {
		const guardian = await this.prisma.guardian.findFirst({
			where: { portalToken: token, deletedAt: null },
			include: {
				participant: {
					include: {
						enrolments: {
							where: { deletedAt: null },
							include: {
								session: true,
								location: true,
								invoices: { where: { deletedAt: null } },
							},
						},
						// do not include staffNotes
					},
				},
			},
		});

		if (!guardian) throw new NotFoundException('Portal token not found');

		const participant = guardian.participant;

		// collect invoices across enrolments
		const invoices = [] as any[];
		for (const e of participant.enrolments || []) {
			for (const inv of e.invoices || []) {
				invoices.push({ amount: inv.amount, dueDate: inv.dueDate, status: inv.status, paymentLink: inv.paymentLink });
			}
		}

		const enrolments = (participant.enrolments || []).map((e) => ({ id: e.id, session: { id: e.session?.id, name: e.session?.name }, location: { id: e.location?.id, name: e.location?.name }, status: e.status, enrolledAt: e.enrolledAt }));

		return {
			participant: { name: `${participant.firstNameEn} ${participant.lastNameEn}`, status: participant.status },
			invoices,
			enrolments,
		};
	}
}
