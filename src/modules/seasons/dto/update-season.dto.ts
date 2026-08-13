import { IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SeasonStatus } from '../../../common/constants/season-status.constants.js';

export class UpdateSeasonDto {
  @ApiPropertyOptional({ example: '2025-26' })
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: '2025-08-31' })
  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-06-06' })
  @IsISO8601()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: SeasonStatus })
  @IsEnum(SeasonStatus)
  @IsOptional()
  status?: SeasonStatus;
}
