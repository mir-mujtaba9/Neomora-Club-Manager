import { Type } from 'class-transformer';
import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
 
class FormGuardianDto {
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
 
/**
 * DTO for the public registration form submission.
 * The locationSlug is taken from the URL param, NOT the body.
 * sessionId is fully optional — if omitted, participant is registered
 * without an enrolment (INQUIRY status).
 */
export class FormRegistrationDto {
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
 
  /**
   * Optional — when omitted the participant is created at INQUIRY status
   * with no enrolment record. The guardian can log in later via the portal
   * and enrol into a session.
   */
  @IsUUID()
  @IsOptional()
  sessionId?: string;
 
  @ValidateNested()
  @Type(() => FormGuardianDto)
  guardian!: FormGuardianDto;
}