import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

export class FindParticipantsDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /**
   * Plan I (F-26) — filter participants whose ENROLMENTS use this payment plan.
   * Resolves to `enrolments: { some: { paymentPlanType } }` in service.
   */
  @IsOptional()
  @IsEnum(PaymentPlanType)
  paymentPlanType?: PaymentPlanType;

  /**
   * Plan I (F-26) — inclusive lower bound on Participant.createdAt.
   * Accepts ISO-8601 (YYYY-MM-DD or full datetime). Parsed once in service.
   */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /**
   * Plan I (F-26) — inclusive upper bound on Participant.createdAt.
   * Service normalises a date-only value to 23:59:59.999 of that day.
   */
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  search?: string;

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
  limit: number = 20;

  @IsOptional()
  @IsString()
  sortBy: string = 'createdAt';

  @IsOptional()
  @IsString()
  order: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  export?: string;
}
