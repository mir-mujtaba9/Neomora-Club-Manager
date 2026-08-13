import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SeasonStatus } from '../../../common/constants/season-status.constants.js';

export class FindSeasonsDto {
  @ApiPropertyOptional({ enum: SeasonStatus })
  @IsEnum(SeasonStatus)
  @IsOptional()
  status?: SeasonStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
