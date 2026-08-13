import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../../../common/constants/session-status.constants.js';

const ALLOWED_TERM_STATUSES = [
  SessionStatus.DRAFT,
  SessionStatus.OPEN,
  SessionStatus.ONGOING,
  SessionStatus.CLOSED,
] as const;

export class UpdateTermDto {
  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  termNumber?: number;

  @ApiPropertyOptional({ example: '2025-09-01' })
  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2025-12-15' })
  @IsISO8601()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  totalWeeks?: number;

  @ApiPropertyOptional({ enum: ALLOWED_TERM_STATUSES })
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: (typeof ALLOWED_TERM_STATUSES)[number];
}
