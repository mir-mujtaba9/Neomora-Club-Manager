import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { CreateUserDto } from './dto/create-user.dto.js';
import { FindUsersDto } from './dto/find-users.dto.js';

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	async create(tenantId: string, dto: CreateUserDto) {
		const normalizedEmail = dto.email.toLowerCase();

		const existing = await this.prisma.user.findFirst({
			where: {
				tenantId,
				email: normalizedEmail,
			},
			select: { id: true },
		});

		if (existing) {
			throw new ConflictException('A user with this email already exists');
		}

		let locationId: string | null = dto.locationId ?? null;
		if (dto.role === UserRole.LOCATION_MANAGER) {
			if (!locationId) {
				throw new BadRequestException('locationId is required for LOCATION_MANAGER');
			}

			const location = await this.prisma.location.findFirst({
				where: { id: locationId, tenantId, deletedAt: null },
				select: { id: true },
			});

			if (!location) {
				throw new BadRequestException('Invalid locationId for this tenant');
			}
		} else {
			locationId = null;
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);

		const user = await this.prisma.user.create({
			data: {
				tenantId,
				email: normalizedEmail,
				fullName: dto.name ?? null,
				passwordHash,
				role: dto.role,
				locationId,
			},
			select: {
				id: true,
				tenantId: true,
				email: true,
				fullName: true,
				role: true,
				locationId: true,
				createdAt: true,
			},
		});

		return {
			...user,
			name: user.fullName,
		};
	}

	async findAll(tenantId: string, query: FindUsersDto) {
		const { role, locationId, page, limit } = query;
		const skip = (page - 1) * limit;

		const where: any = {
			tenantId,
			deletedAt: null,
		};

		if (role) where.role = role;
		if (locationId) where.locationId = locationId;

		const [items, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					tenantId: true,
					email: true,
					fullName: true,
					role: true,
					locationId: true,
					totpEnabled: true,
					locked: true,
					lockedUntil: true,
					lastLoginAt: true,
					createdAt: true,
					location: {
						select: {
							id: true,
							name: true,
							city: true,
							status: true,
						},
					},
				},
			}),
			this.prisma.user.count({ where }),
		]);

		return {
			items: items.map((u) => ({ ...u, name: u.fullName })),
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async findById(tenantId: string, id: string) {
		const user = await this.prisma.user.findFirst({
			where: {
				id,
				tenantId,
				deletedAt: null,
			},
			select: {
				id: true,
				tenantId: true,
				email: true,
				fullName: true,
				role: true,
				locationId: true,
				totpEnabled: true,
				locked: true,
				lockedUntil: true,
				lastLoginAt: true,
				createdAt: true,
				location: {
					select: {
						id: true,
						name: true,
						city: true,
						status: true,
					},
				},
			},
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return {
			...user,
			name: user.fullName,
		};
	}
}
