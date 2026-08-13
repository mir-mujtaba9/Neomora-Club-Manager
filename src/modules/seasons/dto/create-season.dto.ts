import { IsISO8601, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSeasonDto {
  @ApiProperty({ example: '2025-26' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: '2025-08-31' })
  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({ example: '2026-06-06' })
  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;
}
