import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetAvailableTermsDto {
  @ApiProperty({ description: 'Location ID — returns terms offered at this location' })
  @IsUUID()
  @IsNotEmpty()
  locationId!: string;

  @ApiPropertyOptional({ description: 'Program ID — when provided, only terms whose sessions carry matching program rules are returned' })
  @IsUUID()
  @IsOptional()
  programId?: string;
}
