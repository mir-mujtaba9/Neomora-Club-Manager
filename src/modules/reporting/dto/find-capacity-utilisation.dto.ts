import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * Plan I (F-29) — capacity utilisation time-series.
 *
 * `from` / `to` are inclusive ISO-8601 dates. The service computes
 * bucket boundaries based on `interval` and returns one row per
 * (locationId, bucket) tuple. Maximum span is 366 buckets — the
 * service throws if exceeded to keep response sizes bounded.
 */
export class FindCapacityUtilisationDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsNotEmpty()
  @IsISO8601()
  from!: string;

  @IsNotEmpty()
  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval?: 'day' | 'week' | 'month';
}
