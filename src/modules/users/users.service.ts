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
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	private async assertValidLocations(tenantId: string, locationIds: string[]) {
		if (!locationIds || locationIds.length === 0) return;
		const count = await this.prisma.location.count({
			where: { id: { in: locationIds }, tenantId, deletedAt: null },
		});

		if (count !== locationIds.length) {
			throw new BadRequestException('One or more locationIds are invalid for this tenant');
		}
	}

	private formatUser(user: any) {
		const { userLocations, ...rest } = user;
		let locations: Array<{ id: string; name: string; city: string; status: string }> = [];

		if (user.role === UserRole.FINANCE_OFFICER) {
			if (Array.isArray(userLocations)) {
				locations = userLocations
					.map((ul: any) => ul.location)
					.filter(Boolean);
			}
		} else if (user.location) {
			locations = [user.location];
		}

		return {
			...rest,
			name: user.fullName,
			locations,
		};
	}

	private get userSelect() {
		return {
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
			userLocations: {
				select: {
					location: {
						select: {
							id: true,
							name: true,
							city: true,
							status: true,
						},
					},
				},
			},
		};
	}

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
		let assignedLocationIds: string[] = [];

		if (dto.role === UserRole.LOCATION_MANAGER || dto.role === UserRole.STAFF) {
			if (!locationId) {
				throw new BadRequestException(`locationId is required for ${dto.role}`);
			}
			await this.assertValidLocations(tenantId, [locationId]);
		} else if (dto.role === UserRole.FINANCE_OFFICER) {
			locationId = null;
			if (dto.locationIds && dto.locationIds.length > 0) {
				assignedLocationIds = dto.locationIds;
				await this.assertValidLocations(tenantId, assignedLocationIds);
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
				...(assignedLocationIds.length > 0 && {
					userLocations: {
						createMany: {
							data: assignedLocationIds.map((locId) => ({
								tenantId,
								locationId: locId,
							})),
						},
					},
				}),
			},
			select: this.userSelect,
		});

		return this.formatUser(user);
	}

	async findAll(tenantId: string, query: FindUsersDto) {
		const { role, locationId, page, limit } = query;
		const skip = (page - 1) * limit;

		const where: any = {
			tenantId,
			deletedAt: null,
		};

		if (role) where.role = role;
		if (locationId) {
			where.OR = [
				{ locationId },
				{ userLocations: { some: { locationId } } },
			];
		}

		const [items, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
				select: this.userSelect,
			}),
			this.prisma.user.count({ where }),
		]);

		return {
			items: items.map((u) => this.formatUser(u)),
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
			select: this.userSelect,
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return this.formatUser(user);
	}

	async update(tenantId: string, id: string, dto: UpdateUserDto) {
		if (!dto.role && !dto.locationId && dto.locationIds === undefined) {
			throw new BadRequestException('At least one of role, locationId, or locationIds must be provided');
		}

		const existing = await this.prisma.user.findFirst({
			where: { id, tenantId, deletedAt: null },
			select: {
				id: true,
				role: true,
				locationId: true,
			},
		});

		if (!existing) {
			throw new NotFoundException('User not found');
		}

		const nextRole = dto.role ?? (existing.role as unknown as UserRole);
		let nextLocationId: string | null = existing.locationId;
		let shouldUpdateUserLocations = false;
		let newLocationIds: string[] = [];

		if (nextRole === UserRole.LOCATION_MANAGER || nextRole === UserRole.STAFF) {
			if (dto.locationId !== undefined) {
				nextLocationId = dto.locationId;
			}
			if (!nextLocationId) {
				throw new BadRequestException(`locationId is required for ${nextRole}`);
			}
			await this.assertValidLocations(tenantId, [nextLocationId]);
			shouldUpdateUserLocations = true;
			newLocationIds = [];
		} else if (nextRole === UserRole.FINANCE_OFFICER) {
			nextLocationId = null;
			if (dto.locationIds !== undefined) {
				if (dto.locationIds.length > 0) {
					await this.assertValidLocations(tenantId, dto.locationIds);
				}
				shouldUpdateUserLocations = true;
				newLocationIds = dto.locationIds;
			}
		} else {
			nextLocationId = null;
			shouldUpdateUserLocations = true;
			newLocationIds = [];
		}

		if (shouldUpdateUserLocations) {
			await this.prisma.userLocation.deleteMany({
				where: { userId: existing.id, tenantId },
			});
			if (newLocationIds.length > 0) {
				await this.prisma.userLocation.createMany({
					data: newLocationIds.map((locId) => ({
						tenantId,
						userId: existing.id,
						locationId: locId,
					})),
				});
			}
		}

		const updated = await this.prisma.user.update({
			where: { id: existing.id },
			data: {
				role: nextRole,
				locationId: nextLocationId,
			},
			select: this.userSelect,
		});

		return this.formatUser(updated);
	}

	async softDelete(tenantId: string, id: string) {
		const existing = await this.prisma.user.findFirst({
			where: { id, tenantId, deletedAt: null },
			select: { id: true },
		});

		if (!existing) {
			throw new NotFoundException('User not found');
		}

		await Promise.all([
			this.prisma.user.update({
				where: { id: existing.id },
				data: { deletedAt: new Date() },
				select: { id: true },
			}),
			this.prisma.refreshToken.updateMany({
				where: {
					userId: existing.id,
					tenantId,
					revoked: false,
				},
				data: { revoked: true },
			}),
		]);

		return { success: true };
	}
}
