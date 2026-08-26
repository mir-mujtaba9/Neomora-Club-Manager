import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProgramRuleDto } from './create-program-rule.dto.js';

export class CreateProgramWithRuleDto {
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


  @ApiProperty({ type: CreateProgramRuleDto, description: 'Primary eligibility rule created alongside the program' })
  @ValidateNested()
  @Type(() => CreateProgramRuleDto)
  rule!: CreateProgramRuleDto;
}
