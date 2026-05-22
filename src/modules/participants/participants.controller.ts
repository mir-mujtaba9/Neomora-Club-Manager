import { Body, Controller, Post, UseGuards, Get, Query, Param, Res, Patch } from '@nestjs/common';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { ParticipantsService } from './participants.service.js';
import { RegisterParticipantDto } from './dto/register-participant.dto.js';
import { Public } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { FindParticipantsDto } from './dto/find-participants.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Response } from 'express';
import { UpdateParticipantStatusDto } from './dto/update-participant-status.dto.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@Controller('participants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParticipantsController {
	constructor(private readonly participantsService: ParticipantsService) {}

	@Public()
	@Post('register')
	async register(@Body() dto: RegisterParticipantDto) {
		return this.participantsService.register(dto);
	}

	@Get()
	async findAll(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Query() query: FindParticipantsDto,
		@Res() res: Response,
	) {
		const result = await this.participantsService.findAll(tenantId, user, query);

		if (query.export === 'csv') {
			// build CSV
			const rows = [
				['uniqueId', 'firstNameEn', 'lastNameEn', 'phone', 'status', 'location', 'createdAt'],
			];
			for (const p of result.items) {
				rows.push([
					p.uniqueId,
					p.firstNameEn,
					p.lastNameEn,
					p.phone,
					p.status,
					p.location?.name ?? '',
					p.createdAt?.toISOString?.() ?? p.createdAt,
				]);
			}
			const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', 'attachment; filename="participants.csv"');
			return res.send(csv);
		}

		return result;
	}

	@Get(':id')
	async findById(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
	) {
		return this.participantsService.findById(tenantId, user, id);
	}

	@Patch(':id/status')
	@Roles(UserRole.LOCATION_MANAGER)
	async updateStatus(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
		@Body() dto: UpdateParticipantStatusDto,
	) {
		return this.participantsService.updateStatus(tenantId, id, user, dto);
	}
}
