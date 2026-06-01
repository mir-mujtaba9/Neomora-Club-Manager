import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

export class CreateEnrolmentDto {
  @IsUUID()
  @IsNotEmpty()
  participantId!: string;

  @IsUUID()
  @IsNotEmpty()
  sessionId!: string;

  @IsUUID()
  @IsNotEmpty()
  locationId!: string;

  @IsEnum(PaymentPlanType)
  @IsNotEmpty()
  paymentPlanType!: PaymentPlanType;
}
