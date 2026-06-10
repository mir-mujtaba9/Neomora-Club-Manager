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
import { i18nValidationMessage } from 'nestjs-i18n';
import { Gender } from '@prisma/client';
import { IsArabicText } from '../../../common/validators/is-arabic-text.validator.js';

const i18n = {
  notEmpty: i18nValidationMessage('validation.IS_NOT_EMPTY'),
  string: i18nValidationMessage('validation.IS_STRING'),
  email: i18nValidationMessage('validation.IS_EMAIL'),
  uuid: i18nValidationMessage('validation.IS_UUID'),
  iso8601: i18nValidationMessage('validation.IS_ISO_8601'),
  enumOf: i18nValidationMessage('validation.IS_ENUM'),
};

class FormGuardianDto {
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  fullName!: string;
 
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  relationship!: string;
 
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  phone!: string;
 
  @IsEmail({}, { message: i18n.email })
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
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  firstNameEn!: string;
 
  @IsArabicText()
  @IsOptional()
  firstNameAr?: string;
 
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  lastNameEn!: string;
 
  @IsArabicText()
  @IsOptional()
  lastNameAr?: string;
 
  @IsISO8601({}, { message: i18n.iso8601 })
  @IsNotEmpty({ message: i18n.notEmpty })
  dateOfBirth!: string;
 
  @IsEnum(Gender, { message: i18n.enumOf })
  gender!: Gender;
 
  @IsString({ message: i18n.string })
  @IsNotEmpty({ message: i18n.notEmpty })
  phone!: string;
 
  @IsString({ message: i18n.string })
  @IsOptional()
  nationality?: string;
 
  @IsString({ message: i18n.string })
  @IsOptional()
  preferredLang?: string;
 
  /**
   * Optional — when omitted the participant is created at INQUIRY status
   * with no enrolment record. The guardian can log in later via the portal
   * and enrol into a session.
   */
  @IsUUID('all', { message: i18n.uuid })
  @IsOptional()
  sessionId?: string;
 
  @ValidateNested()
  @Type(() => FormGuardianDto)
  guardian!: FormGuardianDto;
}