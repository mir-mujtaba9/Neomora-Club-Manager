-- Add EXACT_BIRTH_YEAR rule type (single-year cohorts, stored as minBirthYear = maxBirthYear)
ALTER TYPE "ProgramRuleType" ADD VALUE 'EXACT_BIRTH_YEAR';
