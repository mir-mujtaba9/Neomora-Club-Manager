import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * DTO for PATCH /enrolments/:id/fee-override.
 *
 * Pass `amount: null` to clear the override (returning to
 * sessionLocation.feeOverride / session.baseFee resolution).
 *
 * `reason` is stored on the AuditLog row so finance can audit later.
 */
export class SetFeeOverrideDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amount?: number | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
