-- Add label to program_rules (human-readable cohort name e.g. "U8", "U10")
ALTER TABLE "program_rules" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';

-- Add base_fee_per_week to programs (nullable — pending client rate-card confirmation)
ALTER TABLE "programs" ADD COLUMN "base_fee_per_week" DECIMAL(10,2);
