import { Body, Controller, Post, UseGuards, Get, Query, Patch, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ApiScopes } from '../../common/decorators/api-scope.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { SessionsService } from './sessions.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { FindSessionsDto } from './dto/find-sessions.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UpdateSessionStatusDto } from './dto/update-session-status.dto.js';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto.js';

@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
export class SessionsController {
	constructor(private readonly sessionsService: SessionsService) {}

	@Post()
	@Roles(UserRole.SUPER_ADMIN)
	async create(@TenantId() tenantId: string, @Body() dto: CreateSessionDto) {
		return this.sessionsService.create(tenantId, dto);
	}

	@Get()
	@ApiScopes('sessions:read')
	@ApiBearerAuth('access-token')
	@ApiSecurity('api-key')
	@ApiOperation({
		summary: 'List sessions',
		description:
			'Paginated list with optional `status`, `locationId`, `dateFrom`, `dateTo` filters. ' +
			'Each item includes `durationDays` (inclusive of start and end day).',
	})
	@ApiResponse({ status: 200, description: 'Paginated sessions.' })
	async findAll(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Query() query: FindSessionsDto,
	) {
		return this.sessionsService.findAll(tenantId, user, query);
	}

	@Patch(':id/status')
	@Roles(UserRole.SUPER_ADMIN)
	async updateStatus(
		@TenantId() tenantId: string,
		@Param('id') id: string,
		@Body() dto: UpdateSessionStatusDto,
	) {
		return this.sessionsService.updateStatus(tenantId, id, dto);
	}

	@Post(':id/payment-plans')
	@Roles(UserRole.SUPER_ADMIN)
	async addPaymentPlan(
		@TenantId() tenantId: string,
		@Param('id') id: string,
		@Body() dto: CreatePaymentPlanDto,
	) {
		return this.sessionsService.addPaymentPlan(tenantId, id, dto);
	}
}
