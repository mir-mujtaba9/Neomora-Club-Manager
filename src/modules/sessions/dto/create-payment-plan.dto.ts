import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

export class CreatePaymentPlanDto {
  @IsEnum(PaymentPlanType)
  @IsNotEmpty()
  type!: PaymentPlanType;

  @IsInt()
  @Min(1)
  instalmentCount!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  instalmentAmount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @IsISO8601({}, { each: true })
  dueDates!: string[];
}
