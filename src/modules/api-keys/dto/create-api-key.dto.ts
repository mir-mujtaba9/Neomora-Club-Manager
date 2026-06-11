import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Plan K (F-34) — body for `POST /api-keys` (SUPER_ADMIN only).
 *
 * Scope strings follow `<resource>:<verb>` convention. The wildcard `*`
 * is permitted but reserved for trusted partners — the controller logs
 * a warning when issued.
 */
export class CreateApiKeyDto {
  /** Human-friendly label shown in lists. Max 80 chars. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  /**
   * Allowed operation scopes (e.g. `participants:read`, `sessions:read`).
   * Must contain at least one entry. Each must match `<resource>:<verb>`
   * or be the wildcard `*`.
   */
  @IsArray()
  @IsString({ each: true })
  @Matches(/^(\*|[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*)$/, {
    each: true,
    message:
      'each scope must be "*" or follow "<resource>:<verb>" (lowercase)',
  })
  scopes!: string[];

  /**
   * Requests / hour. Defaults to 1000 (matches schema default). 0 means
   * "no limit" — gated to SUPER_ADMIN at issue time but the runtime guard
   * treats it as unlimited.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  rateLimit?: number;
}
