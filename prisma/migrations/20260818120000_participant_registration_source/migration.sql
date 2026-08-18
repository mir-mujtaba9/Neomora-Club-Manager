-- Additive: track how a participant record was created (public form vs staff-assisted).
DO $$ BEGIN
  CREATE TYPE "ParticipantRegistrationSource" AS ENUM ('PUBLIC_FORM', 'STAFF_REGISTERED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "participants"
  ADD COLUMN IF NOT EXISTS "registration_source" "ParticipantRegistrationSource" NOT NULL DEFAULT 'PUBLIC_FORM';
