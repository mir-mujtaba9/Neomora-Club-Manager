import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { MarkAttendanceDto } from './dto/mark-attendance.dto.js';
import { BulkMarkAttendanceDto } from './dto/bulk-mark-attendance.dto.js';
import { ListAttendanceDto } from './dto/list-attendance.dto.js';

@Injectable()
export class AttendanceService {
	constructor(private readonly prisma: PrismaService) {}

	// ─── Helpers ─────────────────────────────────────────────────────────

	/**
	 * Resolve the effective locationId for the calling user.
	 * - STAFF / LOCATION_MANAGER are always locked to their own locationId.
	 * - SUPER_ADMIN / FINANCE_OFFICER may supply an explicit locationId via DTO
	 *   or query params; if they don't, the call is unrestricted.
	 */
	private resolveLocationId(user: any, requestedLocationId?: string): string | undefined {
		if (
			user.role === UserRole.STAFF ||
			user.role === UserRole.LOCATION_MANAGER
		) {
			if (!user.locationId) {
				throw new ForbiddenException(
					'Your account is not assigned to a location. Please contact an administrator.',
				);
			}
			return user.locationId as string;
		}
		// SUPER_ADMIN / FINANCE_OFFICER respect the caller-supplied value (if any).
		return requestedLocationId ?? undefined;
	}

	/**
	 * Validate that:
	 * 1. The session exists and belongs to the tenant.
	 * 2. The target date falls within the session window.
	 */
	private async assertSessionDateValid(
		tenantId: string,
		sessionId: string,
		date: Date,
	): Promise<void> {
		const session = await this.prisma.session.findFirst({
			where: { id: sessionId, tenantId, deletedAt: null },
			select: { startDate: true, endDate: true, name: true },
		});

		if (!session) throw new NotFoundException('Session not found');

		const start = new Date(session.startDate);
		const end = new Date(session.endDate);

		// Normalise to date-only for comparison (strip time component).
		start.setHours(0, 0, 0, 0);
		end.setHours(23, 59, 59, 999);

		if (date < start || date > end) {
			throw new BadRequestException(
				`Date ${date.toISOString().slice(0, 10)} is outside the session window ` +
					`(${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)})`,
			);
		}
	}

	/**
	 * Verify the participant has an ACTIVE enrolment for the given session at the
	 * resolved location. Returns the locationId of the enrolment for use in the record.
	 */
	private async assertParticipantEnrolled(
		tenantId: string,
		participantId: string,
		sessionId: string,
		locationId: string,
	): Promise<void> {
		const enrolment = await this.prisma.enrolment.findFirst({
			where: {
				tenantId,
				participantId,
				sessionId,
				locationId,
				status: 'ACTIVE',
				deletedAt: null,
			},
			select: { id: true },
		});

		if (!enrolment) {
			throw new BadRequestException(
				`Participant ${participantId} does not have an ACTIVE enrolment for this session at this location`,
			);
		}
	}

	// ─── Mark single ─────────────────────────────────────────────────────

	async markOne(tenantId: string, user: any, dto: MarkAttendanceDto) {
		const locationId = this.resolveLocationId(user);

		if (!locationId) {
			// SUPER_ADMIN / FINANCE_OFFICER calling markOne without a locationId —
			// they must have an enrolment-level locationId to resolve to; since we
			// don't know which location to use, we look it up from the enrolment.
			throw new BadRequestException(
				'locationId cannot be determined. Please supply it via the request body or ensure your account is location-scoped.',
			);
		}

		const date = new Date(dto.date);
		date.setHours(0, 0, 0, 0);

		await this.assertSessionDateValid(tenantId, dto.sessionId, date);
		await this.assertParticipantEnrolled(tenantId, dto.participantId, dto.sessionId, locationId);

		// Upsert: if a record already exists for this (tenant, participant, session, date)
		// it is overwritten; otherwise a new row is inserted.
		return this.prisma.attendanceRecord.upsert({
			where: {
				tenantId_participantId_sessionId_date: {
					tenantId,
					participantId: dto.participantId,
					sessionId: dto.sessionId,
					date,
				},
			},
			create: {
				tenantId,
				participantId: dto.participantId,
				sessionId: dto.sessionId,
				locationId,
				markedById: user.id,
				date,
				present: dto.present,
				note: dto.note ?? null,
			},
			update: {
				present: dto.present,
				note: dto.note ?? null,
				markedById: user.id,
			},
			include: {
				participant: {
					select: { id: true, firstNameEn: true, lastNameEn: true, uniqueId: true },
				},
				markedBy: { select: { id: true, fullName: true, email: true } },
			},
		});
	}

	// ─── Bulk mark ───────────────────────────────────────────────────────

	async markBulk(tenantId: string, user: any, dto: BulkMarkAttendanceDto) {
		const locationId = this.resolveLocationId(user);

		if (!locationId) {
			throw new BadRequestException(
				'locationId cannot be determined. Ensure your account is location-scoped or supply locationId.',
			);
		}

		const date = new Date(dto.date);
		date.setHours(0, 0, 0, 0);

		await this.assertSessionDateValid(tenantId, dto.sessionId, date);

		const saved: any[] = [];
		const errors: Array<{ participantId: string; reason: string }> = [];

		// Process each entry. We don't abort on individual failures — the entire
		// valid subset is saved in a single transaction at the end.
		for (const entry of dto.records) {
			try {
				await this.assertParticipantEnrolled(
					tenantId,
					entry.participantId,
					dto.sessionId,
					locationId,
				);
				saved.push(entry);
			} catch (err: any) {
				errors.push({ participantId: entry.participantId, reason: err.message });
			}
		}

		if (saved.length > 0) {
			await this.prisma.$transaction(
				saved.map((entry) =>
					this.prisma.attendanceRecord.upsert({
						where: {
							tenantId_participantId_sessionId_date: {
								tenantId,
								participantId: entry.participantId,
								sessionId: dto.sessionId,
								date,
							},
						},
						create: {
							tenantId,
							participantId: entry.participantId,
							sessionId: dto.sessionId,
							locationId,
							markedById: user.id,
							date,
							present: entry.present,
							note: entry.note ?? null,
						},
						update: {
							present: entry.present,
							note: entry.note ?? null,
							markedById: user.id,
						},
					}),
				),
			);
		}

		return { saved: saved.length, errors };
	}

	// ─── List ────────────────────────────────────────────────────────────

	async listAttendance(tenantId: string, user: any, query: ListAttendanceDto) {
		const {
			sessionId,
			date,
			dateFrom,
			dateTo,
			participantId,
			page = 1,
			limit = 20,
			sortBy = 'date',
			order = 'desc',
		} = query;

		// For read endpoints FINANCE_OFFICER is allowed; resolve location for them
		// the same way as SUPER_ADMIN (they can pass an explicit locationId).
		const effectiveLocationId = this.resolveLocationIdForRead(user, query.locationId);

		const where: any = { tenantId };

		if (effectiveLocationId) where.locationId = effectiveLocationId;
		if (sessionId) where.sessionId = sessionId;
		if (participantId) where.participantId = participantId;

		if (date) {
			const d = new Date(date);
			d.setHours(0, 0, 0, 0);
			where.date = d;
		} else if (dateFrom || dateTo) {
			const dateRange: any = {};
			if (dateFrom) {
				const from = new Date(dateFrom);
				from.setHours(0, 0, 0, 0);
				dateRange.gte = from;
			}
			if (dateTo) {
				const to = new Date(dateTo);
				to.setHours(23, 59, 59, 999);
				dateRange.lte = to;
			}
			where.date = dateRange;
		}

		const skip = (page - 1) * limit;

		const [items, total] = await Promise.all([
			this.prisma.attendanceRecord.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
				include: {
					participant: {
						select: {
							id: true,
							firstNameEn: true,
							lastNameEn: true,
							uniqueId: true,
							gender: true,
						},
					},
					session: { select: { id: true, name: true } },
					location: { select: { id: true, name: true, city: true } },
					markedBy: { select: { id: true, fullName: true, email: true } },
				},
			}),
			this.prisma.attendanceRecord.count({ where }),
		]);

		return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
	}

	// ─── Summary ─────────────────────────────────────────────────────────

	async getSummary(
		tenantId: string,
		user: any,
		sessionId: string,
		date?: string,
		locationId?: string,
	) {
		if (!sessionId) {
			throw new BadRequestException('sessionId is required for summary');
		}

		const effectiveLocationId = this.resolveLocationIdForRead(user, locationId);

		const where: any = { tenantId, sessionId };
		if (effectiveLocationId) where.locationId = effectiveLocationId;

		if (date) {
			const d = new Date(date);
			d.setHours(0, 0, 0, 0);
			where.date = d;
		}

		const [presentCount, absentCount] = await Promise.all([
			this.prisma.attendanceRecord.count({ where: { ...where, present: true } }),
			this.prisma.attendanceRecord.count({ where: { ...where, present: false } }),
		]);

		const total = presentCount + absentCount;
		const attendanceRate = total > 0 ? ((presentCount / total) * 100).toFixed(2) : '0.00';

		return {
			sessionId,
			locationId: effectiveLocationId ?? null,
			date: date ?? null,
			total,
			present: presentCount,
			absent: absentCount,
			attendanceRate,
		};
	}

	// ─── Private read-scoping helper ─────────────────────────────────────

	/**
	 * Similar to resolveLocationId but for read endpoints where FINANCE_OFFICER
	 * also has access. They can optionally filter by locationId; if they don't
	 * supply one they see all locations.
	 */
	private resolveLocationIdForRead(user: any, requestedLocationId?: string): string | undefined {
		if (
			user.role === UserRole.STAFF ||
			user.role === UserRole.LOCATION_MANAGER
		) {
			if (!user.locationId) {
				throw new ForbiddenException(
					'Your account is not assigned to a location. Please contact an administrator.',
				);
			}
			return user.locationId as string;
		}
		// SUPER_ADMIN / FINANCE_OFFICER: use caller-supplied value or no filter.
		return requestedLocationId ?? undefined;
	}
}
