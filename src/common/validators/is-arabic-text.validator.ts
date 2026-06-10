import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

/**
 * Plan E — custom class-validator constraint for Arabic personal names.
 *
 * A value passes when, after trimming:
 *   1. It is a non-empty string.
 *   2. Every character is either an Arabic-script letter (Arabic, Arabic
 *      Supplement, Arabic Extended-A, or the two presentation-forms
 *      blocks), whitespace, a ZWNJ/ZWJ joiner, an apostrophe, or a hyphen.
 *   3. At least one character is an Arabic letter (rejects purely
 *      whitespace/punctuation strings).
 *
 * Latin letters, digits, and other scripts are rejected. The default
 * message is the i18n key `validation.IS_ARABIC_TEXT`, translated at
 * the I18nValidationExceptionFilter using the request's resolved
 * language (?lang=, x-lang, Accept-Language).
 */
const ARABIC_LETTER =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;

const ARABIC_NAME_ONLY =
  /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\u200C\u200D'-]+$/u;

@ValidatorConstraint({ name: 'isArabicText', async: false })
export class IsArabicTextConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    return ARABIC_NAME_ONLY.test(trimmed) && ARABIC_LETTER.test(trimmed);
  }
}

export function IsArabicText(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: {
        message: i18nValidationMessage('validation.IS_ARABIC_TEXT'),
        ...validationOptions,
      },
      constraints: [],
      validator: IsArabicTextConstraint,
    });
  };
}
