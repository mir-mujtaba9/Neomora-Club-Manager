import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  tenantSlug!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  /**
   * Plan J (F-33) — required ONLY when the account has `totpEnabled=true`.
   * Validated by class-validator: when present, must be 6 digits (the
   * TOTP standard window). Accepts the string form to preserve leading
   * zeros that Number() would strip.
   */
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'totpCode must be exactly 6 digits' })
  totpCode?: string;
}
