import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

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

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Post('login')
	async login(@Body() dto: LoginDto) {
		return this.authService.login(dto);
	}

	@Public()
	@Post('refresh')
	async refresh(@Body() dto: RefreshDto) {
		return this.authService.refresh(dto);
	}

	@UseGuards(JwtAuthGuard)
	@Get('me')
	async me(@CurrentUser() user: any) {
		return this.authService.me(user);
	}

	@UseGuards(JwtAuthGuard)
	@Post('logout')
	async logout(@CurrentUser() user: any, @Body() dto: LogoutDto) {
		return this.authService.logout(user, dto);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.SUPER_ADMIN)
	@Post('switch-tenant')
	async switchTenant(@CurrentUser() user: any, @Body() dto: SwitchTenantDto) {
		return this.authService.switchTenant(user, dto);
	}

	// ─── Plan J (F-33) — TOTP 2FA endpoints ────────────────────────

	@UseGuards(JwtAuthGuard)
	@Post('2fa/setup')
	async setup2fa(@CurrentUser() user: any) {
		return this.authService.setup2fa(user);
	}

	@UseGuards(JwtAuthGuard)
	@Post('2fa/enable')
	async enable2fa(@CurrentUser() user: any, @Body() dto: Verify2faCodeDto) {
		return this.authService.enable2fa(user, dto);
	}

	@UseGuards(JwtAuthGuard)
	@Post('2fa/disable')
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
	async forgotPassword(@Body() dto: ForgotPasswordDto) {
		return this.authService.forgotPassword(dto);
	}

	@Public()
	@HttpCode(HttpStatus.OK)
	@Post('reset-password')
	async resetPassword(@Body() dto: ResetPasswordDto) {
		return this.authService.resetPassword(dto);
	}
}

