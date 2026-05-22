import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateNested,
  IsEmail,
  IsUUID,
} from 'class-validator';

class GuardianDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  relationship!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

export class RegisterParticipantDto {
  @IsUUID()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsNotEmpty()
  locationSlug!: string;

  @IsString()
  @IsNotEmpty()
  firstNameEn!: string;

  @IsString()
  @IsOptional()
  firstNameAr?: string;

  @IsString()
  @IsNotEmpty()
  lastNameEn!: string;

  @IsString()
  @IsOptional()
  lastNameAr?: string;

  @IsISO8601()
  @IsNotEmpty()
  dateOfBirth!: string;

  @IsString()
  @IsNotEmpty()
  gender!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsOptional()
  nationality?: string;

  @IsString()
  @IsOptional()
  preferredLang?: string;

  @ValidateNested()
  @Type(() => GuardianDto)
  guardian!: GuardianDto;
}
