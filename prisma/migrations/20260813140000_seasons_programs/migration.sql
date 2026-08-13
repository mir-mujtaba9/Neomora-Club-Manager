-- AlterEnum: Add ONGOING to SessionStatus
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'ONGOING' BEFORE 'CLOSED';

-- CreateEnum: SeasonStatus
CREATE TYPE "SeasonStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum: ProgramRuleType
CREATE TYPE "ProgramRuleType" AS ENUM ('BIRTH_YEAR_RANGE');

-- CreateTable: seasons
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seasons_tenant_id_name_key" ON "seasons"("tenant_id", "name");
CREATE INDEX "seasons_tenant_id_status_idx" ON "seasons"("tenant_id", "status");

ALTER TABLE "seasons" ADD CONSTRAINT "seasons_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: sessions — add term columns (all nullable, zero impact on existing rows)
ALTER TABLE "sessions" ADD COLUMN "season_id" TEXT;
ALTER TABLE "sessions" ADD COLUMN "term_number" INTEGER;
ALTER TABLE "sessions" ADD COLUMN "total_weeks" INTEGER;

CREATE INDEX "sessions_tenant_id_season_id_idx" ON "sessions"("tenant_id", "season_id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: programs
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "programs_tenant_code_active_key"
    ON "programs"("tenant_id", "code")
    WHERE ("deleted_at" IS NULL);

CREATE INDEX "programs_tenant_id_idx" ON "programs"("tenant_id");

ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "programs" ADD CONSTRAINT "programs_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: program_rules
CREATE TABLE "program_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "rule_type" "ProgramRuleType" NOT NULL DEFAULT 'BIRTH_YEAR_RANGE',
    "min_birth_year" INTEGER NOT NULL,
    "max_birth_year" INTEGER NOT NULL,
    "sessions_per_week" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "program_rules_program_id_idx" ON "program_rules"("program_id");
CREATE INDEX "program_rules_tenant_id_idx" ON "program_rules"("tenant_id");

ALTER TABLE "program_rules" ADD CONSTRAINT "program_rules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "program_rules" ADD CONSTRAINT "program_rules_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: enrolments — add programme-level columns (all nullable)
ALTER TABLE "enrolments" ADD COLUMN "program_id" TEXT;
ALTER TABLE "enrolments" ADD COLUMN "join_date" DATE;
ALTER TABLE "enrolments" ADD COLUMN "commitment_length" INTEGER;
ALTER TABLE "enrolments" ADD COLUMN "include_kit" BOOLEAN DEFAULT FALSE;

ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
