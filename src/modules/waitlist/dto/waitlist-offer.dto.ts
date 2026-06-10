import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PaymentPlanType } from '../../../common/constants/payment-plan-type.constants.js';

/**
 * Body for `POST /waitlist/accept`. The guardian picks the payment plan
 * at accept-time because the waitlist row never captured it (the original
 * registration that put them on the waitlist may have been hours/days ago,
 * and the available plans for the session may have shifted).
 */
export class AcceptWaitlistOfferDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsEnum(PaymentPlanType, {
    message: `paymentPlanType must be one of: ${Object.values(PaymentPlanType).join(', ')}`,
  })
  paymentPlanType!: PaymentPlanType;
}

/**
 * Body for `POST /waitlist/decline` and `POST /waitlist/withdraw`.
 * Just a token — the row identifies itself.
 */
export class WaitlistTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
