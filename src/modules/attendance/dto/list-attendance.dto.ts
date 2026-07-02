import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAttendanceDto {
	@ApiPropertyOptional({ description: 'Filter by session ID' })
	@IsOptional()
	@IsUUID()
	sessionId?: string;

	@ApiPropertyOptional({
		description: 'Filter by exact calendar date (YYYY-MM-DD)',
		example: '2026-07-02',
	})
	@IsOptional()
	@IsDateString()
	date?: string;

	@ApiPropertyOptional({ description: 'Filter by start date (inclusive)' })
	@IsOptional()
	@IsDateString()
	dateFrom?: string;

	@ApiPropertyOptional({ description: 'Filter by end date (inclusive)' })
	@IsOptional()
	@IsDateString()
	dateTo?: string;

	/**
	 * SUPER_ADMIN / FINANCE_OFFICER can supply this to scope results to a
	 * specific location. STAFF and LOCATION_MANAGER are auto-scoped to their
	 * own locationId and any supplied value here is ignored.
	 */
	@ApiPropertyOptional({ description: 'Location ID (admins only; staff are auto-scoped)' })
	@IsOptional()
	@IsUUID()
	locationId?: string;

	@ApiPropertyOptional({ description: 'Filter by participantId' })
	@IsOptional()
	@IsUUID()
	participantId?: string;

	@ApiPropertyOptional({ default: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number = 1;

	@ApiPropertyOptional({ default: 20 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	limit?: number = 20;

	@ApiPropertyOptional({ enum: ['date', 'createdAt'], default: 'date' })
	@IsOptional()
	@IsIn(['date', 'createdAt'])
	sortBy?: 'date' | 'createdAt' = 'date';

	@ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
	@IsOptional()
	@IsIn(['asc', 'desc'])
	order?: 'asc' | 'desc' = 'desc';
}
