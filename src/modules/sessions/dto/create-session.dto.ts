import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { SessionStatus } from '../../../common/constants/session-status.constants.js';

class SessionLocationDto {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  feeOverride?: number;
}

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  baseFee!: number;

  @IsISO8601()
  @IsOptional()
  enrolOpenAt?: string;

  @IsISO8601()
  @IsOptional()
  enrolCloseAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionLocationDto)
  @IsOptional()
  locations?: SessionLocationDto[];

  @IsString()
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
