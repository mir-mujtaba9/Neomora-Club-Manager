import { IsOptional, IsUUID, Matches, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class FindFeesReportDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  /**
   * Plan I (F-27) — grouping dimension. Default 'location' preserves
   * pre-Plan-I behaviour; 'session' pivots aggregations across sessions.
   */
  @IsOptional()
  @IsIn(['location', 'session'])
  groupBy?: 'location' | 'session';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
