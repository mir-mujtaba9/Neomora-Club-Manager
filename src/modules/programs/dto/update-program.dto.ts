import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProgramDto {
  @ApiPropertyOptional({ example: 'SWIM-SR' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 'Senior Swimming' })
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ description: 'Pass null to make program available at all locations.' })
  @IsString()
  @IsOptional()
  locationId?: string | null;

  @ApiPropertyOptional({
    example: 175.0,
    description: 'Fee per week. Pass null to clear (fee calculated elsewhere).',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  baseFeePerWeek?: number | null;
}
