/*
  Warnings:

  - You are about to drop the column `base_fee_per_week` on the `programs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "program_rules" ALTER COLUMN "label" DROP DEFAULT;

-- AlterTable
ALTER TABLE "programs" DROP COLUMN "base_fee_per_week";

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "weekly_rate" DECIMAL(10,2) NOT NULL,
    "registration_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "kit_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "min_billable_weeks" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_cards_program_id_idx" ON "rate_cards"("program_id");

-- CreateIndex
CREATE INDEX "rate_cards_tenant_id_idx" ON "rate_cards"("tenant_id");

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
