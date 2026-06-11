import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * Plan J (F-33) — body for `POST /auth/2fa/enable` (first activation)
 * and `POST /auth/2fa/disable` (turn off). For disable we additionally
 * require the user's current password to prevent a session-hijack
 * attacker from disabling 2FA silently — that field is on a separate
 * DTO.
 */
export class Verify2faCodeDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  code!: string;
}
