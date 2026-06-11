import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/constants/user-role.constants';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { Verify2faCodeDto } from './dto/verify-2fa-code.dto.js';
import { Disable2faDto } from './dto/disable-2fa.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Post('login')
	@ApiOperation({
		summary: 'Login (email + password, optional TOTP)',
		description:
			'Returns `{ accessToken, refreshToken, user, tenant }`. When the user has `totpEnabled=true` ' +
			'the request MUST include a valid 6-digit `totpCode` or 401 is returned. 5 wrong password ' +
			'attempts in a row lock the account for 15 minutes.',
	})
	@ApiResponse({ status: 200, description: 'JWT tokens + profile.' })
	@ApiResponse({ status: 401, description: 'Invalid credentials or missing/invalid TOTP code.' })
	@ApiResponse({ status: 403, description: 'Account is temporarily locked.' })
	@ApiResponse({ status: 404, description: 'Tenant slug not found.' })
	async login(@Body() dto: LoginDto) {
		return this.authService.login(dto);
	}

	@Public()
	@Post('refresh')
	@ApiOperation({ summary: 'Rotate access + refresh token pair' })
	async refresh(@Body() dto: RefreshDto) {
		return this.authService.refresh(dto);
	}

	@UseGuards(JwtAuthGuard)
	@Get('me')
	@ApiBearerAuth('access-token')
	@ApiOperation({ summary: 'Current user profile' })
	async me(@CurrentUser() user: any) {
		return this.authService.me(user);
	}

	@UseGuards(JwtAuthGuard)
	@Post('logout')
	@ApiBearerAuth('access-token')
	@ApiOperation({
		summary: 'Logout',
		description: 'With body `{refreshToken}` revokes one session; without body revokes ALL sessions for this user in this tenant.',
	})
	async logout(@CurrentUser() user: any, @Body() dto: LogoutDto) {
		return this.authService.logout(user, dto);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.SUPER_ADMIN)
	@Post('switch-tenant')
	@ApiBearerAuth('access-token')
	@ApiOperation({ summary: 'Issue tokens scoped to a different tenant (SUPER_ADMIN only)' })
	async switchTenant(@CurrentUser() user: any, @Body() dto: SwitchTenantDto) {
		return this.authService.switchTenant(user, dto);
	}

	// ─── Plan J (F-33) — TOTP 2FA endpoints ────────────────────────

	@UseGuards(JwtAuthGuard)
	@Post('2fa/setup')
	@ApiBearerAuth('access-token')
	@ApiOperation({
		summary: 'Begin 2FA enrolment',
		description: 'Returns `{secret, otpauthUrl}`. The user scans the URL into Google Authenticator / 1Password, then calls /2fa/enable with a valid code.',
	})
	async setup2fa(@CurrentUser() user: any) {
		return this.authService.setup2fa(user);
	}

	@UseGuards(JwtAuthGuard)
	@Post('2fa/enable')
	@ApiBearerAuth('access-token')
	@ApiOperation({ summary: 'Verify first 2FA code and activate the second factor' })
	async enable2fa(@CurrentUser() user: any, @Body() dto: Verify2faCodeDto) {
		return this.authService.enable2fa(user, dto);
	}

	@UseGuards(JwtAuthGuard)
	@Post('2fa/disable')
	@ApiBearerAuth('access-token')
	@ApiOperation({
		summary: 'Disable 2FA',
		description: 'Requires BOTH a current TOTP code AND the account password (defence against hijacked sessions).',
	})
	async disable2fa(@CurrentUser() user: any, @Body() dto: Disable2faDto) {
		return this.authService.disable2fa(user, dto);
	}

	// ─── Plan J (F-33) — Password reset endpoints ───────────────────

	/**
	 * Always returns 200 regardless of whether the email exists. Do NOT
	 * change this contract — a 404 would let an attacker enumerate users.
	 */
	@Public()
	@HttpCode(HttpStatus.OK)
	@Post('forgot-password')
	@ApiOperation({
		summary: 'Send password-reset email',
		description: 'ALWAYS returns 200 regardless of whether the email matches an account (anti-enumeration).',
	})
	async forgotPassword(@Body() dto: ForgotPasswordDto) {
		return this.authService.forgotPassword(dto);
	}

	@Public()
	@HttpCode(HttpStatus.OK)
	@Post('reset-password')
	@ApiOperation({
		summary: 'Consume a password-reset token',
		description: 'Single-use, 1h TTL. Successful reset revokes ALL active refresh tokens for the user.',
	})
	async resetPassword(@Body() dto: ResetPasswordDto) {
		return this.authService.resetPassword(dto);
	}
}

