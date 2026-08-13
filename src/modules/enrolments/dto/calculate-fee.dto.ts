import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CalculateFeeDto {
  @ApiProperty({ description: 'Location where the enrolment will be created' })
  @IsUUID()
  @IsNotEmpty()
  locationId!: string;

  @ApiProperty({ description: 'Term (Session) ID' })
  @IsUUID()
  @IsNotEmpty()
  sessionId!: string;

  @ApiPropertyOptional({ description: 'Programme ID — drives weekly-rate fee when set' })
  @IsUUID()
  @IsOptional()
  programId?: string;

  @ApiProperty({
    description: 'Number of consecutive terms the student commits to (1, 2, or 3)',
    minimum: 1,
    maximum: 3,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @Max(3)
  @Type(() => Number)
  commitmentLength: number = 1;

  @ApiProperty({ description: 'Date the student will start (ISO 8601, e.g. 2025-09-15)' })
  @IsDateString()
  @IsNotEmpty()
  joinDate!: string;

  @ApiPropertyOptional({ description: 'Whether to include the academy kit fee' })
  @IsOptional()
  includeKit?: boolean;
}
