import { Body, Controller, Post, UseGuards, Get, Query, Param, Res, Patch, Delete, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { ParticipantsService } from './participants.service.js';
import { RegisterParticipantDto } from './dto/register-participant.dto.js';
import { Public } from '../../common/decorators/roles.decorator.js';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ApiScopes } from '../../common/decorators/api-scope.decorator.js';
import { FindParticipantsDto } from './dto/find-participants.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Response } from 'express';
import { UpdateParticipantStatusDto } from './dto/update-participant-status.dto.js';
import { CreateStaffNoteDto } from './dto/create-staff-note.dto.js';
import { ReEnrolDto } from '../enrolments/dto/re-enrol.dto.js';
import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@ApiTags('Participants')
@Controller('participants')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
export class ParticipantsController {
	constructor(
		private readonly participantsService: ParticipantsService,
		// Plan H Phase 4 — convenience POST /:id/re-enrol delegates to the
		// real EnrolmentsService.reEnrol after looking up the most-recent
		// enrolment so the caller doesn't need to know the prior id.
		private readonly enrolmentsService: EnrolmentsService,
		private readonly prisma: PrismaService,
	) {}

	@Public()
	@Post('register')
	async register(@Body() dto: RegisterParticipantDto) {
		return this.participantsService.register(dto);
	}

	@Get('public-requests')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
	@ApiBearerAuth('access-token')
	async getPublicRequests(@TenantId() tenantId: string) {
		return this.participantsService.getPublicRequests(tenantId);
	}

	@Get()
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	@ApiScopes('participants:read')
	@ApiBearerAuth('access-token')
	@ApiSecurity('api-key')
	@ApiOperation({
		summary: 'List participants',
		description:
			'Paginated list. Filters: `status`, `locationId`, `sessionId`, `paymentPlanType`, `dateFrom`, `dateTo`, `search` (uniqueId / phone / name). ' +
			'`?export=csv` returns a CSV download. LOCATION_MANAGER is auto-scoped to their own location.',
	})
	@ApiResponse({ status: 200, description: 'Paginated participants or CSV download.' })
	@ApiResponse({ status: 401, description: 'Missing or invalid JWT / API key.' })
	@ApiResponse({ status: 403, description: 'Role / scope not permitted.' })
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
				[
					'uniqueId',
					'firstNameEn',
					'lastNameEn',
					'phone',
					'status',
					'location',
					'guardianName',
					'guardianRelationship',
					'guardianPhone',
					'guardianEmail',
					'createdAt',
				],
			];
			for (const p of result.items) {
				const primaryGuardian = (p as any).guardians?.[0];
				rows.push([
					p.uniqueId,
					p.firstNameEn,
					p.lastNameEn,
					p.phone,
					p.status,
					p.location?.name ?? '',
					primaryGuardian?.fullName ?? '',
					primaryGuardian?.relationship ?? '',
					primaryGuardian?.phone ?? '',
					primaryGuardian?.email ?? '',
					p.createdAt?.toISOString?.() ?? p.createdAt,
				]);
			}
			const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', 'attachment; filename="participants.csv"');
			return res.send(csv);
		}

		return res.json(result);
	}

	@Get('staff-registered')
	@Roles(UserRole.SUPER_ADMIN)
	@ApiBearerAuth('access-token')
	@ApiOperation({
		summary: 'List participants registered via staff-register (SUPER_ADMIN only)',
		description:
			'Returns participants whose record was created through the staff "Register Student" form ' +
			'(POST /enrolments/staff-register), as opposed to public self-registration. ' +
			'Supports the same pagination/search/sort filters as GET /participants.',
	})
	@ApiResponse({ status: 200, description: 'Paginated staff-registered participants.' })
	@ApiResponse({ status: 403, description: 'Only SUPER_ADMIN may access this endpoint.' })
	async findStaffRegistered(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Query() query: FindParticipantsDto,
	) {
		return this.participantsService.findStaffRegistered(tenantId, user, query);
	}

	@Get(':id')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	@ApiScopes('participants:read')
	@ApiBearerAuth('access-token')
	@ApiSecurity('api-key')
	@ApiOperation({
		summary: 'Get participant by id (360° profile)',
		description:
			'Returns participant + guardians + enrolments (with `paymentSummary`) + documents + staff notes. ' +
			'Sessions ordered most recent first; staff notes newest first with `author`.',
	})
	@ApiResponse({ status: 200, description: 'Participant profile.' })
	@ApiResponse({ status: 404, description: 'Participant not found in this tenant.' })
	async findById(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
	) {
		return this.participantsService.findById(tenantId, user, id);
	}

	@Patch(':id/status')
	@Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
	async updateStatus(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
		@Body() dto: UpdateParticipantStatusDto,
	) {
		return this.participantsService.updateStatus(tenantId, id, user, dto);
	}

	// ─── Plan H — Staff notes (F-22) ────────────────────────────────────
	// Notes are visible to staff only; the @Roles guard keeps guardians out.
// Staff notes are not part of the participant profile returned by GET /:id, but are listed separately via GET /:id/staff-notes.
	@Get(':id/staff-notes')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	async listStaffNotes(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
	) {
		return this.participantsService.listStaffNotes(tenantId, id, user);
	}

	@Post(':id/staff-notes')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	async addStaffNote(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
		@Body() dto: CreateStaffNoteDto,
	) {
		return this.participantsService.addStaffNote(tenantId, id, user, dto);
	}

	@Delete(':id/staff-notes/:noteId')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	async deleteStaffNote(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
		@Param('noteId') noteId: string,
	) {
		return this.participantsService.deleteStaffNote(tenantId, id, noteId, user);
	}

	// ─── Plan H — Status history (F-20) ─────────────────────────────────

	@Get(':id/status-history')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
	async getStatusHistory(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
	) {
		return this.participantsService.getStatusHistory(tenantId, id, user);
	}

	// ─── Plan H — Convenience re-enrol (F-24) ───────────────────────────
	// EnrolmentsService.reEnrol requires the previous enrolment id; this
	// route looks it up automatically (most-recent enrolment for the
	// participant) so a single click in the staff UI can re-enrol them
	// into a new session. Real work happens in EnrolmentsService.reEnrol
	// which already enforces overlap + duplicate-active rules.
	@Post(':id/re-enrol')
	@Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.STAFF)
	async reEnrol(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Param('id') id: string,
		@Body() dto: ReEnrolDto,
		@Query('allowOverlap') allowOverlap?: string,
	) {
		const previous = await this.prisma.enrolment.findFirst({
			where: { tenantId, participantId: id, deletedAt: null },
			orderBy: { enrolledAt: 'desc' },
			select: { id: true },
		});
		if (!previous) {
			throw new NotFoundException('No previous enrolment found for this participant');
		}
		return this.enrolmentsService.reEnrol(tenantId, user, previous.id, dto, {
			allowOverlap: allowOverlap === 'true',
		});
	}
}
