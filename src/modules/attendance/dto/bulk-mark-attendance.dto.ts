import { Type } from 'class-transformer';
import {
	IsArray,
	IsBoolean,
	IsDateString,
	IsOptional,
	IsString,
	IsUUID,
	ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkAttendanceEntryDto {
	@ApiProperty({ description: 'Participant ID' })
	@IsUUID()
	participantId!: string;

	@ApiProperty({ description: 'true = present, false = absent' })
	@IsBoolean()
	present!: boolean;

	@ApiPropertyOptional({ description: 'Optional per-participant note' })
	@IsOptional()
	@IsString()
	note?: string;
}

export class BulkMarkAttendanceDto {
	@ApiProperty({ description: 'Session ID shared across all entries' })
	@IsUUID()
	sessionId!: string;

	@ApiProperty({
		description: 'Calendar date of the class in ISO format (YYYY-MM-DD)',
		example: '2026-07-02',
	})
	@IsDateString()
	date!: string;

	@ApiProperty({
		description: 'Array of participant attendance entries',
		type: [BulkAttendanceEntryDto],
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => BulkAttendanceEntryDto)
	records!: BulkAttendanceEntryDto[];
}
