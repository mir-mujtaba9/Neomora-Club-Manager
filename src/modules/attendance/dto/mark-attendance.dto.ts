import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkAttendanceDto {
	@ApiProperty({ description: 'Participant ID to mark attendance for' })
	@IsUUID()
	participantId!: string;

	@ApiProperty({ description: 'Session ID the participant is enrolled in' })
	@IsUUID()
	sessionId!: string;

	@ApiProperty({
		description: 'Calendar date of the class in ISO format (YYYY-MM-DD)',
		example: '2026-07-02',
	})
	@IsDateString()
	date!: string;

	@ApiProperty({ description: 'true = present, false = absent' })
	@IsBoolean()
	present!: boolean;

	@ApiPropertyOptional({ description: 'Optional note (e.g. "arrived late")' })
	@IsOptional()
	@IsString()
	note?: string;
}
