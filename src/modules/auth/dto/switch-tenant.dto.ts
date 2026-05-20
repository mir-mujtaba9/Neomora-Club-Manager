import { IsOptional, IsString } from 'class-validator';

export class SwitchTenantDto {
  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}
