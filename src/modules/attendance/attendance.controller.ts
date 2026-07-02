import {
	Body,
	Controller,
	Get,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';

import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { AttendanceService } from './attendance.service.js';
import { MarkAttendanceDto } from './dto/mark-attendance.dto.js';
import { BulkMarkAttendanceDto } from './dto/bulk-mark-attendance.dto.js';
import { ListAttendanceDto } from './dto/list-attendance.dto.js';

// ─────────────────────────────────────────────────────────────────────────────
// Write roles: STAFF, LOCATION_MANAGER, SUPER_ADMIN
// Read roles:  the above + FINANCE_OFFICER
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class AttendanceController {
	constructor(private readonly attendanceService: AttendanceService) {}

	// ─── Mark single attendance ───────────────────────────────────────────

	@Post()
	@Roles(UserRole.STAFF, UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
	@ApiOperation({
		summary: 'Mark attendance for a single participant',
		description:
			'Creates or updates an attendance record for a participant on a given class date. ' +
			'STAFF are automatically scoped to their assigned location. ' +
			'Calling with the same participantId + sessionId + date overwrites the previous record (idempotent upsert).',
	})
	@ApiResponse({ status: 201, description: 'Attendance record created / updated.' })
	@ApiResponse({ status: 400, description: 'Participant not enrolled, or date outside session window.' })
	@ApiResponse({ status: 403, description: 'Role not permitted or account not location-scoped.' })
	@ApiResponse({ status: 404, description: 'Session not found.' })
	async markOne(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Body() dto: MarkAttendanceDto,
	) {
		return this.attendanceService.markOne(tenantId, user, dto);
	}

	// ─── Bulk mark attendance ─────────────────────────────────────────────

	@Post('bulk')
	@Roles(UserRole.STAFF, UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
	@ApiOperation({
		summary: 'Bulk-mark attendance for a full session roster',
		description:
			'Upserts attendance records for multiple participants in a single request. ' +
			'All records share the same sessionId and date. ' +
			'Participants that fail the eligibility check (not ACTIVE-enrolled at the location) ' +
			'are returned in the `errors` array; all valid participants are saved atomically.',
	})
	@ApiResponse({
		status: 201,
		description: 'Returns { saved: number, errors: Array<{ participantId, reason }> }.',
	})
	@ApiResponse({ status: 400, description: 'Date outside session window, or no session found.' })
	@ApiResponse({ status: 403, description: 'Role not permitted or account not location-scoped.' })
	async markBulk(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Body() dto: BulkMarkAttendanceDto,
	) {
		return this.attendanceService.markBulk(tenantId, user, dto);
	}

	// ─── List attendance records ──────────────────────────────────────────

	@Get()
	@Roles(
		UserRole.STAFF,
		UserRole.LOCATION_MANAGER,
		UserRole.SUPER_ADMIN,
		UserRole.FINANCE_OFFICER,
	)
	@ApiOperation({
		summary: 'List attendance records',
		description:
			'Paginated list of attendance records. Supports filtering by sessionId, date, ' +
			'dateFrom/dateTo, participantId, and locationId (admins only — STAFF are auto-scoped). ' +
			'Results include participant info, session, location, and who marked the record.',
	})
	@ApiResponse({ status: 200, description: 'Paginated attendance records.' })
	@ApiResponse({ status: 403, description: 'Account not location-scoped (STAFF without locationId).' })
	async listAttendance(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Query() query: ListAttendanceDto,
	) {
		return this.attendanceService.listAttendance(tenantId, user, query);
	}

	// ─── Attendance summary ───────────────────────────────────────────────

	@Get('summary')
	@Roles(
		UserRole.STAFF,
		UserRole.LOCATION_MANAGER,
		UserRole.SUPER_ADMIN,
		UserRole.FINANCE_OFFICER,
	)
	@ApiOperation({
		summary: 'Attendance summary for a session',
		description:
			'Returns present / absent counts and attendance-rate percentage for a session. ' +
			'Optionally filter by a specific date. STAFF are auto-scoped to their location.',
	})
	@ApiResponse({
		status: 200,
		description:
			'{ sessionId, locationId, date, total, present, absent, attendanceRate }',
	})
	@ApiResponse({ status: 400, description: 'sessionId is required.' })
	async getSummary(
		@TenantId() tenantId: string,
		@CurrentUser() user: any,
		@Query('sessionId') sessionId: string,
		@Query('date') date?: string,
		@Query('locationId') locationId?: string,
	) {
		return this.attendanceService.getSummary(tenantId, user, sessionId, date, locationId);
	}
}
