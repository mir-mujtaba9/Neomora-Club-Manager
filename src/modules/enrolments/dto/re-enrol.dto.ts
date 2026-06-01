import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

export class ReEnrolDto {
  @IsUUID()
  @IsNotEmpty()
  sessionId!: string;

  @IsEnum(PaymentPlanType)
  @IsNotEmpty()
  paymentPlanType!: PaymentPlanType;
}
