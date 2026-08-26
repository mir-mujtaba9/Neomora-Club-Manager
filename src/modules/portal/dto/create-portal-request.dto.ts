import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class PortalGuardianDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  relationship!: string;

  @IsUUID()
  @IsNotEmpty()
  primaryLocationId!: string;
}

export class CreatePortalRequestDto {
  @IsString()
  @IsNotEmpty()
  firstNameEn!: string;

  @IsString()
  @IsNotEmpty()
  lastNameEn!: string;

  @IsISO8601()
  @IsNotEmpty()
  dateOfBirth!: string;

  @IsEnum(Gender)
  @IsNotEmpty()
  gender!: Gender;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsUUID()
  @IsOptional()
  programId?: string;

  @IsUUID('all', { each: true })
  @IsOptional()
  termIds?: string[];

  @IsUUID()
  @IsOptional()
  locationId?: string;

  @IsString()
  @IsOptional()
  tenant_slug?: string;

  @ValidateNested()
  @Type(() => PortalGuardianDto)
  @IsNotEmpty()
  guardian!: PortalGuardianDto;
}

