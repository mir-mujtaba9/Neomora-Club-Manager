import { IsDecimal, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { PaymentPlanType } from '@prisma/client';

/**
 * DTO for POST /enrolments/:id/payment-plan.
 *
 * - `planType` is required.
 * - `instalmentCount` is required for MONTHLY/SEASONAL, ignored for FULL
 *   (forced to 1 in the service).
 * - When omitted, `instalmentAmount` is auto-computed by the instalment
 *   generator from the enrolment's total fee.
 */
export class CreateEnrolmentPlanDto {
  @IsEnum(PaymentPlanType)
  planType!: PaymentPlanType;

  @IsInt()
  @Min(1)
  @IsOptional()
  instalmentCount?: number;
}
