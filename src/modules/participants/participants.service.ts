import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { RegisterParticipantDto } from './dto/register-participant.dto.js';
import { generateUniqueId } from '../../common/utils/unique-id.util.js';
import { nextTenantSequence } from '../../common/utils/tenant-sequence.util.js';
import { EnrolmentAllocatorService } from '../enrolments/enrolment-allocator.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
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
		private readonly storage: StorageService,
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

	async findAll(
		tenantId: string,
		user: any,
		query: FindParticipantsDto,
		extraWhere: Record<string, any> = {},
	) {
		const {
			status,
			locationId,
			sessionId,
			guardianId,
			paymentPlanType,
			dateFrom,
			dateTo,
			search,
			page = 1,
			limit = 20,
			sortBy = 'createdAt',
			order = 'desc',
		} = query;
		const skip = (page - 1) * limit;

		const where: any = { tenantId, deletedAt: null };
		if (status) where.status = status;
		if (locationId) where.locationId = locationId;

		if (guardianId) {
			const targetGuardian = await this.prisma.guardian.findFirst({
				where: { id: guardianId, tenantId, deletedAt: null },
			});
			if (!targetGuardian) {
				throw new NotFoundException('Guardian not found');
			}
			const sameGuardians = await this.prisma.guardian.findMany({
				where: {
					tenantId,
					deletedAt: null,
					OR: [
						{ phone: targetGuardian.phone },
						...(targetGuardian.email ? [{ email: targetGuardian.email }] : []),
					],
				},
				select: { participantId: true },
			});
			const participantIds = sameGuardians.map((g) => g.participantId);
			where.id = { in: participantIds };
		}

		// Plan I (F-26) — sessionId + paymentPlanType both target the same
		// enrolments relation, so AND them inside a single `some` clause to
		// avoid matching participants where the conditions live on different
		// enrolments (which would happen if we wrote two separate `some`s).
		if (sessionId || paymentPlanType) {
			const enrolmentFilter: any = {};
			if (sessionId) enrolmentFilter.sessionId = sessionId;
			if (paymentPlanType) enrolmentFilter.paymentPlanType = paymentPlanType;
			where.enrolments = { some: enrolmentFilter };
		}

		// Plan I (F-26) — date range on participant.createdAt. Date-only
		// upper bound is bumped to end-of-day so the UI doesn't need to
		// know about the 23:59:59 convention.
		if (dateFrom || dateTo) {
			const createdAt: any = {};
			if (dateFrom) createdAt.gte = new Date(dateFrom);
			if (dateTo) {
				const upper = new Date(dateTo);
				if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
					upper.setHours(23, 59, 59, 999);
				}
				createdAt.lte = upper;
			}
			where.createdAt = createdAt;
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

		Object.assign(where, extraWhere);

		const [items, total] = await Promise.all([
			this.prisma.participant.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
				include: {
					location: { select: { id: true, name: true, city: true } },
					guardians: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
				},
			}),
			this.prisma.participant.count({ where }),
		]);

		return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
	}

	/**
	 * Admin-only view of participants whose record originated from the staff
	 * "Register Student" form (POST /enrolments/staff-register).
	 *
	 * Returns a rich paginated payload matching the UI table columns:
	 *   STUDENT | GUARDIAN | PROGRAM | BRANCH | TERMS | TOTAL | PAID | BALANCE | STATUS
	 */
	async findStaffRegistered(tenantId: string, user: any, query: FindParticipantsDto) {
		const {
			locationId,
			search,
			page = 1,
			limit = 20,
			sortBy = 'createdAt',
			order = 'desc',
		} = query;

		const skip = (page - 1) * limit;

		const where: any = {
			tenantId,
			deletedAt: null,
			registrationSource: 'STAFF_REGISTERED',
		};

		if (locationId) where.locationId = locationId;

		if (search) {
			where.OR = [
				{ firstNameEn: { contains: search, mode: 'insensitive' } },
				{ lastNameEn: { contains: search, mode: 'insensitive' } },
				{ uniqueId: { contains: search, mode: 'insensitive' } },
				{ phone: { contains: search, mode: 'insensitive' } },
				{
					guardians: {
						some: {
							deletedAt: null,
							OR: [
								{ fullName: { contains: search, mode: 'insensitive' } },
								{ phone: { contains: search, mode: 'insensitive' } },
							],
						},
					},
				},
			];
		}

		// LOCATION_MANAGER is scoped to their own location
		if (user?.role === UserRole.LOCATION_MANAGER && user.locationId) {
			where.locationId = user.locationId;
		}

		const [participants, total] = await Promise.all([
			this.prisma.participant.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
				include: {
					// Branch
					location: { select: { id: true, name: true, city: true } },
					// Guardian (primary = oldest)
					guardians: {
						where: { deletedAt: null },
						orderBy: { createdAt: 'asc' },
						select: { id: true, fullName: true, relationship: true, phone: true, email: true },
					},
					// Enrolments with program, session, location, invoices for TERMS/finance columns
					enrolments: {
						where: { deletedAt: null },
						orderBy: { enrolledAt: 'desc' },
						include: {
							program: { select: { id: true, name: true } },
							session: { select: { id: true, name: true, termNumber: true } },
							location: { select: { id: true, name: true } },
							invoices: {
								where: { deletedAt: null },
								orderBy: { instalmentNo: 'asc' },
								select: {
									id: true,
									instalmentNo: true,
									instalmentTotal: true,
									amount: true,
									status: true,
									dueDate: true,
								},
							},
						},
					},
				},
			}),
			this.prisma.participant.count({ where }),
		]);

		// Shape each participant into the UI-column format
		const items = participants.map((p: any) => {
			const primaryGuardian = p.guardians?.[0] ?? null;

			// Aggregate across all active enrolments
			const enrolmentRows = (p.enrolments ?? []).map((e: any) => {
				const totalFee = Number(e.totalFee ?? 0);
				const paidAmount = Number(e.paidAmount ?? 0);
				const balance = Number(e.balance ?? 0);

				// Build term badges from invoices (T1, T2, T3 …)
				const terms = (e.invoices ?? []).map((inv: any) => ({
					label: inv.instalmentNo != null ? `T${inv.instalmentNo}` : 'T1',
					instalmentNo: inv.instalmentNo,
					amount: Number(inv.amount),
					status: inv.status,
					dueDate: inv.dueDate,
				}));

				// Payment status: PAID when balance ≤ 0, else UNPAID
				const paymentStatus = balance <= 0 ? 'PAID' : 'UNPAID';

				return {
					enrolmentId: e.id,
					status: e.status,
					program: e.program ? { id: e.program.id, name: e.program.name } : null,
					session: e.session
						? { id: e.session.id, name: e.session.name, termNumber: e.session.termNumber }
						: null,
					branch: e.location ? { id: e.location.id, name: e.location.name } : null,
					terms,
					totalFee: totalFee.toFixed(2),
					paid: paidAmount.toFixed(2),
					balance: balance.toFixed(2),
					paymentStatus,
					enrolledAt: e.enrolledAt,
				};
			});

			return {
				id: p.id,
				uniqueId: p.uniqueId,
				// STUDENT column
				student: {
					firstNameEn: p.firstNameEn,
					lastNameEn: p.lastNameEn,
					fullName: `${p.firstNameEn} ${p.lastNameEn}`,
					phone: p.phone,
					status: p.status,
				},
				// GUARDIAN column
				guardian: primaryGuardian
					? {
							id: primaryGuardian.id,
							fullName: primaryGuardian.fullName,
							relationship: primaryGuardian.relationship,
							phone: primaryGuardian.phone,
							email: primaryGuardian.email,
						}
					: null,
				// BRANCH column (participant's home location)
				branch: p.location ? { id: p.location.id, name: p.location.name } : null,
				// All enrolments with PROGRAM, TERMS, TOTAL, PAID, BALANCE, STATUS
				enrolments: enrolmentRows,
				createdAt: p.createdAt,
			};
		});

		return {
			items,
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	async findById(tenantId: string, user: any, id: string) {
		const participant = await this.prisma.participant.findFirst({
			where: { id, tenantId, deletedAt: null },
			include: {
				location: true,
				guardians: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
				// Plan H — newest enrolment first so session history reads top-down.
				enrolments: {
					where: { deletedAt: null },
					orderBy: { enrolledAt: 'desc' },
					include: {
						session: true,
						location: true,
						invoices: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
						payments: { orderBy: { createdAt: 'desc' } },
					},
				},
				documents: { where: { deletedAt: null }, orderBy: { uploadedAt: 'desc' } },
				// Plan H — include author name so the UI doesn't need a second hop.
				staffNotes: {
					where: { deletedAt: null },
					orderBy: { createdAt: 'desc' },
					include: { author: { select: { id: true, fullName: true, email: true } } },
				},
			},
		});

		if (!participant) throw new NotFoundException('Participant not found');

		// Plan H — collapse payments across enrolments AND compute a per-enrolment
		// summary so the 360° view shows finance state at a glance.
		const enrolmentsWithSummary = (participant.enrolments || []).map((e: any) => {
			const completed = (e.payments || []).filter((p: any) => p.status === 'COMPLETED');
			const totalPaid = completed.reduce(
				(sum: number, p: any) => sum + Number(p.amount),
				0,
			);
			const totalInvoiced = (e.invoices || []).reduce(
				(sum: number, inv: any) => sum + Number(inv.amount),
				0,
			);
			return {
				...e,
				paymentSummary: {
					totalInvoiced: totalInvoiced.toFixed(2),
					totalPaid: totalPaid.toFixed(2),
					outstanding: (totalInvoiced - totalPaid).toFixed(2),
					lastPaymentAt: completed[0]?.createdAt ?? null,
				},
			};
		});

		// Flat list of payments across enrolments (newest-first) for the
		// summary card. Mirrors the previous behaviour.
		const payments = await this.prisma.payment.findMany({
			where: { enrolment: { participantId: id } },
			orderBy: { createdAt: 'desc' },
		});

		const response: any = {
			participant: { ...participant },
			guardians: participant.guardians || [],
			enrolments: enrolmentsWithSummary,
			documents: participant.documents || [],
			payments,
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

		// Plan F-11 — gate manual FEE_PENDING → ACTIVE on outstanding balance.
		// SUPER_ADMIN and FINANCE_OFFICER can override; everyone else gets the
		// guard. The auto-promotion service runs on payment.verify so this
		// branch only fires when staff try to promote manually.
		if (current === 'FEE_PENDING' && next === 'ACTIVE') {
			const canOverride =
				user?.role === UserRole.SUPER_ADMIN ||
				user?.role === UserRole.FINANCE_OFFICER;
			if (!canOverride) {
				const tenant = await this.prisma.tenant.findUnique({
					where: { id: tenantId },
					select: { balanceThreshold: true },
				});
				const threshold = tenant?.balanceThreshold ?? null;
				const outstanding = await this.prisma.enrolment.findFirst({
					where: {
						tenantId,
						participantId: participant.id,
						deletedAt: null,
						status: { in: ['FEE_PENDING', 'DOCUMENTS_PENDING'] },
						...(threshold !== null && { balance: { gt: threshold } }),
					},
					select: { id: true, balance: true },
				});
				if (outstanding) {
					throw new BadRequestException(
						`Cannot promote to ACTIVE — enrolment ${outstanding.id} has outstanding balance ${outstanding.balance.toString()} > threshold ${threshold?.toString() ?? '0'}. Record a payment first.`,
					);
				}
			}
		}

		const updated = await this.prisma.participant.update({ where: { id: participant.id }, data: { status: dto.status as any } });

		// Plan H — every transition writes an AuditLog row so the
		// status-history endpoint can reconstruct the participant's timeline.
		// Best-effort: if the audit insert fails we still return the update.
		await this.prisma.auditLog
			.create({
				data: {
					tenantId,
					userId: user?.id ?? user?.sub ?? null,
					action: 'PARTICIPANT_STATUS_CHANGED',
					resource: 'participant',
					resourceId: participant.id,
					beforeState: { status: current } as any,
					afterState: { status: next, reason: dto.reason ?? null } as any,
				},
			})
			.catch(() => undefined);

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

		const note = await this.prisma.staffNote.create({
			data: { tenantId, participantId: participant.id, authorId: user.id, note: dto.note },
			include: { author: { select: { id: true, fullName: true, email: true } } },
		});
		return note;
	}

	/**
	 * Plan H — list staff notes for a participant, newest-first, with author
	 * details. Guardians never get here (route is role-gated) but we still
	 * return an empty list for non-staff to keep the response shape stable.
	 */
	async listStaffNotes(tenantId: string, participantId: string, user: any) {
		const participant = await this.prisma.participant.findFirst({
			where: { id: participantId, tenantId, deletedAt: null },
			select: { id: true, locationId: true },
		});
		if (!participant) throw new NotFoundException('Participant not found');

		if (
			user?.role === UserRole.LOCATION_MANAGER &&
			user.locationId !== participant.locationId
		) {
			return [];
		}

		return this.prisma.staffNote.findMany({
			where: { tenantId, participantId, deletedAt: null },
			orderBy: { createdAt: 'desc' },
			include: { author: { select: { id: true, fullName: true, email: true } } },
		});
	}

	/**
	 * Plan H — soft-delete a staff note. Only the original author or a
	 * SUPER_ADMIN may delete; this matches the "my notes" expectation while
	 * leaving an escape hatch for admin clean-up.
	 */
	async deleteStaffNote(
		tenantId: string,
		participantId: string,
		noteId: string,
		user: any,
	) {
		const note = await this.prisma.staffNote.findFirst({
			where: { id: noteId, tenantId, participantId, deletedAt: null },
		});
		if (!note) throw new NotFoundException('Staff note not found');

		const isAuthor = user?.id === note.authorId;
		const isAdmin = user?.role === UserRole.SUPER_ADMIN;
		if (!isAuthor && !isAdmin) {
			throw new BadRequestException('Only the author or a super admin may delete this note');
		}

		await this.prisma.staffNote.update({
			where: { id: noteId },
			data: { deletedAt: new Date() },
		});
		return { id: noteId, deleted: true };
	}

	/**
	 * Plan H — reconstruct the participant's status timeline from AuditLog
	 * rows written by `updateStatus` and `AutoPromotionService.tryPromote`.
	 * Falls back to a single "CREATED" entry derived from `createdAt` when
	 * no audit rows exist yet (participants that pre-date Plan H).
	 */
	async getStatusHistory(tenantId: string, participantId: string, user: any) {
		const participant = await this.prisma.participant.findFirst({
			where: { id: participantId, tenantId, deletedAt: null },
			select: { id: true, status: true, locationId: true, createdAt: true },
		});
		if (!participant) throw new NotFoundException('Participant not found');

		if (
			user?.role === UserRole.LOCATION_MANAGER &&
			user.locationId !== participant.locationId
		) {
			throw new BadRequestException('Not allowed to view history for participant in different location');
		}

		const auditRows = await this.prisma.auditLog.findMany({
			where: {
				tenantId,
				resource: 'participant',
				resourceId: participantId,
				action: { in: ['PARTICIPANT_STATUS_CHANGED', 'AUTO_PROMOTED_TO_ACTIVE'] },
			},
			orderBy: { createdAt: 'asc' },
			include: { user: { select: { id: true, fullName: true, email: true } } },
		});

		const timeline = auditRows.map((row) => ({
			at: row.createdAt,
			action: row.action,
			from: (row.beforeState as any)?.status ?? null,
			to: (row.afterState as any)?.status ?? null,
			reason: (row.afterState as any)?.reason ?? null,
			actor: row.user
				? { id: row.user.id, fullName: row.user.fullName, email: row.user.email }
				: { id: row.userId, fullName: 'system', email: null },
		}));

		// Always include the synthetic "REGISTERED" entry at the top so the
		// timeline starts from a known point even for pre-Plan-H records.
		timeline.unshift({
			at: participant.createdAt,
			action: 'PARTICIPANT_REGISTERED',
			from: null,
			to: 'INQUIRY',
			reason: null,
			actor: { id: null, fullName: 'system', email: null },
		});

		return {
			participantId,
			currentStatus: participant.status,
			timeline,
		};
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
								// Plan H — pull payments here so the guardian sees their
								// full payment history without a second query.
								payments: { orderBy: { createdAt: 'desc' } },
							},
						},
						// staffNotes intentionally NOT loaded — guardian-private payload.
					},
				},
			},
		});

		if (!guardian) throw new NotFoundException('Portal token not found');

		const participant = guardian.participant;

		// Plan H — split invoices into upcoming / overdue / paid so the
		// portal UI doesn't need to compute due-date logic client-side.
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const upcomingInvoices: any[] = [];
		const overdueInvoices: any[] = [];
		const paidInvoices: any[] = [];

		// Plan H — collect a flat payment history list with signed receipt
		// URLs. Only COMPLETED payments are surfaced to guardians; pending /
		// rejected ones stay internal to staff.
		const paymentHistory: any[] = [];

		for (const e of participant.enrolments || []) {
			for (const inv of e.invoices || []) {
				const row = {
					invoiceNumber: inv.invoiceNumber,
					amount: inv.amount,
					dueDate: inv.dueDate,
					status: inv.status,
					paymentLink: inv.paymentLink,
				};
				if (inv.status === 'PAID') {
					paidInvoices.push(row);
				} else if (inv.dueDate < today) {
					overdueInvoices.push(row);
				} else {
					upcomingInvoices.push(row);
				}
			}

			for (const p of e.payments || []) {
				if (p.status !== 'COMPLETED') continue;
				let receiptUrl: string | null = null;
				if (p.receiptKey) {
					try {
						const signed = await this.storage.getSignedUrl(p.receiptKey, 7 * 24 * 3600);
						receiptUrl = signed.url;
					} catch {
						// Signing failure shouldn't kill the whole portal payload —
						// just omit the URL and let the guardian retry later.
					}
				}
				paymentHistory.push({
					id: p.id,
					amount: p.amount,
					method: p.method,
					gateway: p.gateway,
					paidAt: p.paidAt ?? p.createdAt,
					receiptUrl,
				});
			}
		}

		// Stable chronological order (newest-first) regardless of which
		// enrolment the payment came from.
		paymentHistory.sort(
			(a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
		);

		const enrolments = (participant.enrolments || []).map((e) => ({
			id: e.id,
			session: { id: e.session?.id, name: e.session?.name },
			location: { id: e.location?.id, name: e.location?.name },
			status: e.status,
			enrolledAt: e.enrolledAt,
		}));

		return {
			participant: {
				name: `${participant.firstNameEn} ${participant.lastNameEn}`,
				status: participant.status,
			},
			enrolments,
			invoices: {
				upcoming: upcomingInvoices,
				overdue: overdueInvoices,
				paid: paidInvoices,
			},
			paymentHistory,
		};
	}
}
