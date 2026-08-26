import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProgramDto {
  @ApiProperty({ example: 'SWIM-JR' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 'Junior Swimming' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ description: 'Scope program to a location. Omit for all locations.' })
  @IsString()
  @IsOptional()
  locationId?: string;

}
