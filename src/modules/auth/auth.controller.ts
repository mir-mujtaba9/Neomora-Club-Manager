import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

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
}

