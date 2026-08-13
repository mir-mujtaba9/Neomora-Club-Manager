import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

export class CreateEnrolmentDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  participantId!: string;

  @ApiProperty({ description: 'Term ID (Session with seasonId) or legacy Session ID' })
  @IsUUID()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  locationId!: string;

  @ApiProperty({ enum: PaymentPlanType })
  @IsEnum(PaymentPlanType)
  @IsNotEmpty()
  paymentPlanType!: PaymentPlanType;

  @ApiPropertyOptional({
    description:
      'Programme the participant is enrolling into. When set, fee is calculated as ' +
      'Program.baseFeePerWeek × term.totalWeeks and capacity is checked against the ' +
      'matching ProgramRule for the participant\'s birth year.',
  })
  @IsUUID()
  @IsOptional()
  programId?: string;
}
