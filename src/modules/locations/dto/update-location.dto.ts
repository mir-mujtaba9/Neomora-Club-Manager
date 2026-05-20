import { IsNumber, IsOptional, IsString, IsEnum, IsArray } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsNumber()
  capacity?: number;

  @IsOptional()
  @IsEnum(['active', 'inactive', 'maintenance'])
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}
