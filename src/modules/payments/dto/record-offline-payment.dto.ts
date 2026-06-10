import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/**
 * DTO for POST /payments/offline.
 *
 * Used by finance staff to record an externally-collected payment
 * (cash, bank transfer). The proof of payment, when present, is a
 * storageKey returned by POST /payments/proof-upload.
 *
 * `idempotencyKey` is REQUIRED — the column is @unique and refusing
 * duplicates is the only safeguard against accidental double-creation
 * if the staff member's network drops mid-request.
 */
export class RecordOfflinePaymentDto {
  @IsUUID()
  @IsNotEmpty()
  enrolmentId!: string;

  @IsUUID()
  @IsOptional()
  invoiceId?: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  proofKey?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
