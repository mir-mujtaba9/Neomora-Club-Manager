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
import { randomBytes, randomUUID } from 'crypto';
import { authenticator } from 'otplib';

import { PrismaService } from '../../infra/database/prisma.service';
import { UserRole } from '../../common/constants/user-role.constants';
import { hashTokenSha256 } from '../../common/utils/token-hash.util.js';
import { parseDurationToMs } from '../../common/utils/duration.util.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { Verify2faCodeDto } from './dto/verify-2fa-code.dto.js';
import { Disable2faDto } from './dto/disable-2fa.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

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
	/** Plan J (F-33) — password-reset token lifetime. Short on purpose. */
	private readonly RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
	private readonly RESET_TOKEN_TTL_HUMAN = '1 hour';

	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly notifications: NotificationsService,
	) {
		// Tighten TOTP defaults: 30s step, ±1 window for clock skew tolerance.
		authenticator.options = { step: 30, window: 1 };
	}

	async login(dto: LoginDto) {
		const { tenantSlug, email, password, totpCode } = dto;
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
				totpSecret: true,
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

		// Plan J (F-33) — TOTP gate. When the account has 2FA enabled we
		// MUST require a valid 6-digit code BEFORE issuing tokens. Note that
		// failing the TOTP step does NOT consume the lockout counter (it's
		// already past the password check) but it still returns 401, so an
		// attacker without the second factor cannot proceed.
		if (user.totpEnabled) {
			if (!totpCode) {
				throw new UnauthorizedException('TOTP code required');
			}
			if (!user.totpSecret) {
				// Defensive: schema invariant says secret is non-null when
				// enabled. If it's missing the user can't authenticate at all.
				throw new UnauthorizedException('Invalid credentials');
			}
			const ok = authenticator.verify({ token: totpCode, secret: user.totpSecret });
			if (!ok) {
				throw new UnauthorizedException('Invalid TOTP code');
			}
		}

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

	// ─── Plan J (F-33) — TOTP 2FA ────────────────────────────────

	/**
	 * Begin TOTP enrolment: generate a fresh secret, persist it on the
	 * user (but DO NOT yet flip `totpEnabled=true`), and return the
	 * provisioning URI for the authenticator app. The user must call
	 * `enable2fa` with a valid 6-digit code before the second factor is
	 * actually required at login.
	 */
	async setup2fa(user: ActorUser) {
		const userRow = await this.prisma.user.findFirst({
			where: { id: user.sub, tenantId: user.tenantId, deletedAt: null },
			select: { id: true, email: true, totpEnabled: true },
		});
		if (!userRow) {
			throw new NotFoundException('User not found');
		}
		if (userRow.totpEnabled) {
			throw new BadRequestException('2FA is already enabled. Disable it first to re-enrol.');
		}

		const secret = authenticator.generateSecret();
		const issuer = this.configService.get<string>('app.name') || 'Neomora Club Manager';
		const otpauthUrl = authenticator.keyuri(userRow.email, issuer, secret);

		// Persist secret immediately so `enable2fa` can verify against it.
		// If the user abandons setup, the secret stays dormant (totpEnabled
		// remains false) and will be overwritten on the next setup call.
		await this.prisma.user.update({
			where: { id: userRow.id },
			data: { totpSecret: secret },
		});

		return { secret, otpauthUrl };
	}

	/**
	 * Verify the first TOTP code and flip `totpEnabled=true`. From this
	 * point on, login requires the second factor.
	 */
	async enable2fa(user: ActorUser, dto: Verify2faCodeDto) {
		const userRow = await this.prisma.user.findFirst({
			where: { id: user.sub, tenantId: user.tenantId, deletedAt: null },
			select: { id: true, totpEnabled: true, totpSecret: true },
		});
		if (!userRow) {
			throw new NotFoundException('User not found');
		}
		if (userRow.totpEnabled) {
			return { success: true, alreadyEnabled: true };
		}
		if (!userRow.totpSecret) {
			throw new BadRequestException('Call /auth/2fa/setup first to obtain a secret');
		}

		const ok = authenticator.verify({ token: dto.code, secret: userRow.totpSecret });
		if (!ok) {
			throw new UnauthorizedException('Invalid TOTP code');
		}

		await this.prisma.user.update({
			where: { id: userRow.id },
			data: { totpEnabled: true },
		});

		return { success: true };
	}

	/**
	 * Disable 2FA. Requires BOTH a current TOTP code AND the account
	 * password — a hijacked browser session alone is not enough.
	 */
	async disable2fa(user: ActorUser, dto: Disable2faDto) {
		const userRow = await this.prisma.user.findFirst({
			where: { id: user.sub, tenantId: user.tenantId, deletedAt: null },
			select: { id: true, passwordHash: true, totpEnabled: true, totpSecret: true },
		});
		if (!userRow) {
			throw new NotFoundException('User not found');
		}
		if (!userRow.totpEnabled || !userRow.totpSecret) {
			return { success: true, alreadyDisabled: true };
		}

		const passwordOk = await bcrypt.compare(dto.password, userRow.passwordHash);
		if (!passwordOk) {
			throw new UnauthorizedException('Invalid credentials');
		}

		const codeOk = authenticator.verify({ token: dto.code, secret: userRow.totpSecret });
		if (!codeOk) {
			throw new UnauthorizedException('Invalid TOTP code');
		}

		await this.prisma.user.update({
			where: { id: userRow.id },
			data: { totpEnabled: false, totpSecret: null },
		});

		return { success: true };
	}

	// ─── Plan J (F-33) — Password reset ────────────────────────────

	/**
	 * Initiate a password-reset flow. The response is intentionally
	 * identical (`{success: true}`) regardless of whether the email
	 * exists, so the endpoint cannot be used to enumerate accounts.
	 * The token plaintext is only ever transmitted in the email body;
	 * we store a SHA-256 hash so a DB leak doesn't expose live tokens.
	 */
	async forgotPassword(dto: ForgotPasswordDto): Promise<{ success: true }> {
		const normalizedEmail = dto.email.toLowerCase();

		const tenant = await this.prisma.tenant.findFirst({
			where: { slug: dto.tenantSlug, deletedAt: null, status: 'ACTIVE' },
			select: { id: true },
		});
		if (!tenant) {
			return { success: true };
		}

		const user = await this.prisma.user.findFirst({
			where: {
				tenantId: tenant.id,
				email: normalizedEmail,
				deletedAt: null,
			},
			// NOTE: the staff User model has no `preferredLang` column (that
			// lives on Guardian). Default password-reset emails to English;
			// the template registry falls back to en regardless.
			select: { id: true, email: true, fullName: true },
		});
		if (!user) {
			return { success: true };
		}

		const tokenPlain = randomBytes(32).toString('hex');
		const tokenHash = hashTokenSha256(tokenPlain);
		const expiresAt = new Date(Date.now() + this.RESET_TOKEN_TTL_MS);

		await this.prisma.passwordResetToken.create({
			data: {
				userId: user.id,
				tenantId: tenant.id,
				tokenHash,
				expiresAt,
			},
		});

		const webBase =
			this.configService.get<string>('app.webBaseUrl') ||
			this.configService.get<string>('WEB_BASE_URL') ||
			'';
		const resetUrl = webBase
			? `${webBase.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(tokenPlain)}`
			: `/reset-password?token=${encodeURIComponent(tokenPlain)}`;

		// Fire-and-forget; failure here MUST NOT change the response.
		void this.notifications.enqueuePasswordReset({
			tenantId: tenant.id,
			userId: user.id,
			userName: user.fullName || user.email,
			userEmail: user.email,
			userLang: 'en',
			resetUrl,
			expiresIn: this.RESET_TOKEN_TTL_HUMAN,
			token: tokenPlain,
		});

		return { success: true };
	}

	/**
	 * Consume a reset token and set a new password. On success we also
	 * revoke ALL of the user's refresh tokens so any pre-existing
	 * sessions (including a possible attacker session) are killed.
	 */
	async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
		const tokenHash = hashTokenSha256(dto.token);
		const now = new Date();

		const record = await this.prisma.passwordResetToken.findUnique({
			where: { tokenHash },
			select: {
				id: true,
				userId: true,
				tenantId: true,
				expiresAt: true,
				usedAt: true,
			},
		});
		if (!record || record.usedAt || record.expiresAt <= now) {
			throw new BadRequestException('Token is invalid or expired');
		}

		const newHash = await bcrypt.hash(dto.newPassword, 10);

		await this.prisma.$transaction([
			this.prisma.user.update({
				where: { id: record.userId },
				data: {
					passwordHash: newHash,
					failedAttempts: 0,
					locked: false,
					lockedUntil: null,
				},
			}),
			this.prisma.passwordResetToken.update({
				where: { id: record.id },
				data: { usedAt: now },
			}),
			// Kill all active refresh tokens for this user across the tenant.
			this.prisma.refreshToken.updateMany({
				where: {
					userId: record.userId,
					tenantId: record.tenantId,
					revoked: false,
				},
				data: { revoked: true },
			}),
		]);

		return { success: true };
	}
}

