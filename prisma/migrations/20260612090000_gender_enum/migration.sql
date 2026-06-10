-- Plan E — Gender enum
-- Replaces the freeform `gender TEXT NOT NULL` column on participants with
-- a proper Postgres enum. The CASE WHEN cast handles all reasonable
-- inputs found in dev/staging data:
--   - 'MALE' / 'male' / 'M' / 'm'   → MALE
--   - 'FEMALE' / 'female' / 'F' / 'f' → FEMALE
-- Any unmappable value yields NULL which fails the NOT NULL constraint,
-- aborting the migration loudly so bad data surfaces BEFORE deploy
-- rather than after.

-- 1) Create the new enum type. IF NOT EXISTS so the migration is
--    re-runnable in case a partial apply needs retry.
DO $$ BEGIN
  CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Cast the column. The USING clause is the conversion expression.
ALTER TABLE "participants"
  ALTER COLUMN "gender" TYPE "Gender" USING (
    CASE
      WHEN UPPER(TRIM("gender")) IN ('MALE',   'M') THEN 'MALE'::"Gender"
      WHEN UPPER(TRIM("gender")) IN ('FEMALE', 'F') THEN 'FEMALE'::"Gender"
      -- intentionally no ELSE — unmapped values → NULL → fails NOT NULL
    END
  );
