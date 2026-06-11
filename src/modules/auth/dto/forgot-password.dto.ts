import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Plan J (F-33) — initiate a password-reset email. Endpoint always
 * returns 200 regardless of whether the email exists, so the response
 * shape cannot leak account presence.
 */
export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  tenantSlug!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
