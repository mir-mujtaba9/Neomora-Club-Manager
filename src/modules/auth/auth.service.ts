import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../infra/database/prisma.service';
import { UserRole } from '../../common/constants/user-role.constants';
import { hashTokenSha256 } from '../../common/utils/token-hash.util.js';
import { parseDurationToMs } from '../../common/utils/duration.util.js';

import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';

type ActorUser = {
	sub: string;
	email: string;
	role: UserRole;
	tenantId: string;
	locationId?: string | null;
};

@Injectable()
export class AuthService {
	private readonly MAX_FAILED_ATTEMPTS = 5;
	private readonly LOCK_MINUTES = 15;

	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
	) {}

	async login(dto: LoginDto) {
		const { tenantSlug, email, password } = dto;
		const normalizedEmail = email.toLowerCase();

		const tenant = await this.prisma.tenant.findFirst({
			where: {
				slug: tenantSlug,
				deletedAt: null,
				status: 'ACTIVE',
			},
			select: { id: true, slug: true, name: true, status: true },
		});

		if (!tenant) {
			throw new NotFoundException('Tenant not found');
		}

		const user = await this.prisma.user.findFirst({
			where: {
				tenantId: tenant.id,
				email: normalizedEmail,
				deletedAt: null,
			},
			select: {
				id: true,
				email: true,
				passwordHash: true,
				role: true,
				tenantId: true,
				locationId: true,
				failedAttempts: true,
				locked: true,
				lockedUntil: true,
				totpEnabled: true,
			},
		});

		if (!user) {
			throw new UnauthorizedException('Invalid credentials');
		}

		const now = new Date();
		if (user.locked && user.lockedUntil && user.lockedUntil > now) {
			throw new ForbiddenException('Account is temporarily locked');
		}

		const passwordOk = await bcrypt.compare(password, user.passwordHash);
		if (!passwordOk) {
			const failedAttempts = (user.failedAttempts ?? 0) + 1;
			const shouldLock = failedAttempts >= this.MAX_FAILED_ATTEMPTS;

			await this.prisma.user.update({
				where: { id: user.id },
				data: {
					failedAttempts,
					locked: shouldLock,
					lockedUntil: shouldLock
						? new Date(now.getTime() + this.LOCK_MINUTES * 60_000)
						: null,
				},
			});

			throw new UnauthorizedException('Invalid credentials');
		}

		// Reset lock counters on successful login
		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				failedAttempts: 0,
				locked: false,
				lockedUntil: null,
				lastLoginAt: now,
			},
		});

		// NOTE: TOTP is optional for now; if enabled we'll still allow login.
		const actor: ActorUser = {
			sub: user.id,
			email: normalizedEmail,
			role: user.role as unknown as UserRole,
			tenantId: user.tenantId,
			locationId: user.locationId,
		};

		const tokens = await this.issueTokens(actor);
		return {
			...tokens,
			user: {
				id: user.id,
				email: user.email,
				role: user.role,
				tenantId: user.tenantId,
				locationId: user.locationId,
				totpEnabled: user.totpEnabled,
			},
			tenant: {
				id: tenant.id,
				slug: tenant.slug,
				name: tenant.name,
			},
		};
	}

	async refresh(dto: RefreshDto) {
		const { refreshToken } = dto;

		const payload = await this.verifyRefreshToken(refreshToken);

		const user = await this.prisma.user.findFirst({
			where: {
				id: payload.sub,
				tenantId: payload.tenantId,
				deletedAt: null,
			},
			select: { id: true, email: true, role: true, tenantId: true, locationId: true },
		});

		if (!user) {
			throw new UnauthorizedException('Account is inactive');
		}

		const tokenRecord = await this.prisma.refreshToken.findUnique({
			where: { jti: payload.jti },
			select: {
				id: true,
				tokenHash: true,
				revoked: true,
				expiresAt: true,
				userId: true,
				tenantId: true,
			},
		});

		if (!tokenRecord || tokenRecord.revoked) {
			throw new UnauthorizedException('Refresh token is invalid');
		}

		if (tokenRecord.expiresAt <= new Date()) {
			throw new UnauthorizedException('Refresh token has expired');
		}

		const incomingHash = hashTokenSha256(refreshToken);
		if (incomingHash !== tokenRecord.tokenHash) {
			throw new UnauthorizedException('Refresh token is invalid');
		}

		// Rotate: revoke old record
		await this.prisma.refreshToken.update({
			where: { id: tokenRecord.id },
			data: { revoked: true },
		});

		const actor: ActorUser = {
			sub: user.id,
			email: user.email,
			role: user.role as unknown as UserRole,
			tenantId: user.tenantId,
			locationId: user.locationId ?? null,
		};

		return this.issueTokens(actor);
	}

	async logout(user: ActorUser, dto: LogoutDto) {
		if (!user?.sub) {
			throw new UnauthorizedException('Not authenticated');
		}

		if (!dto?.refreshToken) {
			// Logout all sessions for this user in this tenant context
			await this.prisma.refreshToken.updateMany({
				where: {
					userId: user.sub,
					tenantId: user.tenantId,
					revoked: false,
				},
				data: { revoked: true },
			});
			return { success: true };
		}

		const payload = await this.verifyRefreshToken(dto.refreshToken);
		if (payload.sub !== user.sub) {
			throw new ForbiddenException('Cannot revoke another user token');
		}

		await this.prisma.refreshToken.updateMany({
			where: {
				jti: payload.jti,
				userId: user.sub,
				revoked: false,
			},
			data: { revoked: true },
		});

		return { success: true };
	}

	async me(user: ActorUser) {
		if (!user?.sub) {
			throw new UnauthorizedException('Not authenticated');
		}

		return {
			id: user.sub,
			email: user.email,
			role: user.role,
			tenantId: user.tenantId,
			locationId: user.locationId ?? null,
		};
	}

	async switchTenant(user: ActorUser, dto: SwitchTenantDto) {
		if (user.role !== UserRole.SUPER_ADMIN) {
			throw new ForbiddenException('Only SUPER_ADMIN can switch tenant');
		}

		const { tenantId, tenantSlug } = dto;
		if (!tenantId && !tenantSlug) {
			throw new BadRequestException('tenantId or tenantSlug is required');
		}

		const tenant = await this.prisma.tenant.findFirst({
			where: {
				...(tenantId ? { id: tenantId } : { slug: tenantSlug }),
				deletedAt: null,
				status: 'ACTIVE',
			},
			select: { id: true, slug: true, name: true },
		});

		if (!tenant) {
			throw new NotFoundException('Tenant not found');
		}

		const actor: ActorUser = {
			sub: user.sub,
			email: user.email,
			role: user.role,
			tenantId: tenant.id,
			locationId: user.locationId ?? null,
		};

		const tokens = await this.issueTokens(actor);
		return {
			...tokens,
			tenant: {
				id: tenant.id,
				slug: tenant.slug,
				name: tenant.name,
			},
		};
	}

	private async issueTokens(actor: ActorUser) {
		const accessJti = randomUUID();
		const refreshJti = randomUUID();

		const accessPayload: Record<string, any> = {
			sub: actor.sub,
			email: actor.email,
			role: actor.role,
			tenantId: actor.tenantId,
			locationId: actor.locationId ?? null,
			jti: accessJti,
		};

		const refreshPayload: Record<string, any> = {
			...accessPayload,
			jti: refreshJti,
			typ: 'refresh',
		};

		const accessToken = await this.jwtService.signAsync(accessPayload);

		const refreshSecret =
			this.configService.get<string>('jwt.refreshSecret') ||
			this.configService.get<string>('JWT_REFRESH_SECRET') ||
			this.configService.get<string>('jwt.secret') ||
			this.configService.get<string>('JWT_SECRET') ||
			'default-secret-change-me';

		const refreshExpiresIn =
			this.configService.get<string>('jwt.refreshExpiresIn') ||
			this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
			'7d';

		const refreshToken = await this.jwtService.signAsync(refreshPayload, {
			secret: refreshSecret,
			expiresIn: refreshExpiresIn as any,
		});

		const expiresAt = new Date(Date.now() + parseDurationToMs(refreshExpiresIn));
		const tokenHash = hashTokenSha256(refreshToken);

		await this.prisma.refreshToken.create({
			data: {
				userId: actor.sub,
				tenantId: actor.tenantId,
				jti: refreshJti,
				tokenHash,
				revoked: false,
				expiresAt,
			},
		});

		return { accessToken, refreshToken };
	}

	private async verifyRefreshToken(refreshToken: string) {
		const refreshSecret =
			this.configService.get<string>('jwt.refreshSecret') ||
			this.configService.get<string>('JWT_REFRESH_SECRET') ||
			this.configService.get<string>('jwt.secret') ||
			this.configService.get<string>('JWT_SECRET') ||
			'default-secret-change-me';

		try {
			const payload: any = await this.jwtService.verifyAsync(refreshToken, {
				secret: refreshSecret,
			});

			if (payload?.typ !== 'refresh') {
				throw new UnauthorizedException('Invalid refresh token');
			}

			if (!payload?.sub || !payload?.tenantId || !payload?.jti) {
				throw new UnauthorizedException('Invalid refresh token');
			}

			return {
				sub: payload.sub as string,
				email: payload.email as string,
				role: payload.role as UserRole,
				tenantId: payload.tenantId as string,
				locationId: (payload.locationId ?? null) as string | null,
				jti: payload.jti as string,
			};
		} catch {
			throw new UnauthorizedException('Refresh token is invalid');
		}
	}
}

