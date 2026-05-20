import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestLinkDto {
  @IsString()
  @IsNotEmpty()
  tenantSlug!: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
