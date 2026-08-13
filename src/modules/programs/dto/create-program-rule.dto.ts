import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProgramRuleType } from '../../../common/constants/program-rule-type.constants.js';

export class CreateProgramRuleDto {
  @ApiProperty({ example: 'U8', description: 'Human-readable cohort name shown on UI and invoices' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiPropertyOptional({ enum: ProgramRuleType, default: ProgramRuleType.BIRTH_YEAR_RANGE })
  @IsEnum(ProgramRuleType)
  @IsOptional()
  ruleType?: ProgramRuleType = ProgramRuleType.BIRTH_YEAR_RANGE;

  @ApiProperty({ example: 2015, description: 'Minimum birth year (inclusive)' })
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  minBirthYear!: number;

  @ApiProperty({ example: 2020, description: 'Maximum birth year (inclusive)' })
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  maxBirthYear!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sessionsPerWeek!: number;

  @ApiProperty({ example: 20, description: 'Maximum enrolments for this cohort' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity!: number;
}
