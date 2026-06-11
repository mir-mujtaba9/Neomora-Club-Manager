import { IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

/**
 * Plan J (F-33) — disabling 2FA requires BOTH a current TOTP code and
 * the account password, so a stolen browser session alone cannot turn
 * off the second factor.
 */
export class Disable2faDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  code!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
