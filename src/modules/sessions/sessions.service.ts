import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { UpdateSessionStatusDto } from './dto/update-session-status.dto.js';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto.js';
import { PaymentPlanType } from '../../common/constants/payment-plan-type.constants.js';

@Injectable()
export class SessionsService {
	constructor(private readonly prisma: PrismaService) {}

	private async assertValidLocation(tenantId: string, locationId: string) {
		const location = await this.prisma.location.findFirst({
			where: { id: locationId, tenantId, deletedAt: null },
			select: { id: true },
		});

		if (!location) {
			throw new BadRequestException('Invalid locationId for this tenant');
		}
	}

	async create(tenantId: string, dto: CreateSessionDto) {
		const start = new Date(dto.startDate);
		const end = new Date(dto.endDate);

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			throw new BadRequestException('Invalid startDate or endDate');
		}

		if (start > end) {
			throw new BadRequestException('startDate must be before endDate');
		}

		if (dto.enrolOpenAt && dto.enrolCloseAt) {
			const open = new Date(dto.enrolOpenAt);
			const close = new Date(dto.enrolCloseAt);
			if (isNaN(open.getTime()) || isNaN(close.getTime())) {
				throw new BadRequestException('Invalid enrolOpenAt or enrolCloseAt');
			}
			if (open > close) {
				throw new BadRequestException('enrolOpenAt must be before enrolCloseAt');
			}
		}

		const locationsData = [] as any[];
		if (dto.locations && dto.locations.length > 0) {
			for (const l of dto.locations) {
				await this.assertValidLocation(tenantId, l.locationId);
				locationsData.push({ locationId: l.locationId, feeOverride: l.feeOverride ?? null });
			}
		}

		const created = await this.prisma.session.create({
			data: {
				tenantId,
				name: dto.name,
				startDate: new Date(dto.startDate),
				endDate: new Date(dto.endDate),
				baseFee: dto.baseFee as any,
				enrolOpenAt: dto.enrolOpenAt ? new Date(dto.enrolOpenAt) : null,
				enrolCloseAt: dto.enrolCloseAt ? new Date(dto.enrolCloseAt) : null,
				status: dto.status as any,
				sessionLocations: locationsData.length
					? { create: locationsData }
					: undefined,
			},
			include: { sessionLocations: true },
		});

		return created;
	}

	async findAll(tenantId: string, user: any, query: any) {
		const { status, locationId, page = 1, limit = 20 } = query;
		const skip = (page - 1) * limit;

		const where: any = {
			tenantId,
			deletedAt: null,
		};

		if (status) where.status = status;

		if (locationId) {
			where.sessionLocations = { some: { locationId } };
		}

		const [items, total] = await Promise.all([
			this.prisma.session.findMany({
				where,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
				include: {
					sessionLocations: {
						select: {
							id: true,
							locationId: true,
							feeOverride: true,
							location: { select: { id: true, name: true, city: true } },
						},
					},
				},
			}),
			this.prisma.session.count({ where }),
		]);

		return {
			items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async updateStatus(tenantId: string, id: string, dto: UpdateSessionStatusDto) {
		const session = await this.prisma.session.findFirst({
			where: { id, tenantId, deletedAt: null },
			select: { id: true, status: true },
		});

		if (!session) throw new NotFoundException('Session not found');

		const current = session.status as unknown as string;
		const next = dto.status as unknown as string;

		const allowed: Record<string, string> = {
			DRAFT: 'OPEN',
			OPEN: 'CLOSED',
			CLOSED: 'ARCHIVED',
		};

		if (allowed[current] !== next) {
			throw new BadRequestException('Invalid status transition');
		}

		const updated = await this.prisma.session.update({
			where: { id: session.id },
			data: { status: dto.status as any },
		});

		return updated;
	}

	async addPaymentPlan(tenantId: string, sessionId: string, dto: CreatePaymentPlanDto) {
		const session = await this.prisma.session.findFirst({
			where: { id: sessionId, tenantId, deletedAt: null },
			select: { id: true, startDate: true, endDate: true },
		});

		if (!session) throw new NotFoundException('Session not found');

		if (dto.dueDates.length !== dto.instalmentCount) {
			throw new BadRequestException('instalmentCount must equal number of dueDates');
		}

		// ensure dueDates are within session bounds if present
		const start = new Date(session.startDate);
		const end = new Date(session.endDate);
		for (const d of dto.dueDates) {
			const dd = new Date(d);
			if (isNaN(dd.getTime())) throw new BadRequestException('Invalid dueDates');
			if (dd < start || dd > end) {
				throw new BadRequestException('dueDates must be within session start/end dates');
			}
		}

		const created = await this.prisma.paymentPlan.create({
			data: {
				tenantId,
				sessionId: session.id,
				type: dto.type as any,
				instalmentCount: dto.instalmentCount,
				instalmentAmount: dto.instalmentAmount as any,
				dueDates: dto.dueDates.map((d) => new Date(d)),
			},
		});

		return created;
	}
}
