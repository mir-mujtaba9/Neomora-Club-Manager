import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectPaymentDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
