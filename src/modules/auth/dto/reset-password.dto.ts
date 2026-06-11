import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Plan J (F-33) — consume a previously-issued password-reset token.
 * Token uniqueness is enforced at the DB level; the service flips
 * `usedAt` inside a transaction so a re-submit of the same token
 * within the TTL window cannot be replayed.
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  newPassword!: string;
}
