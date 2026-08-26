-- CreateEnum
CREATE TYPE "DiscountRuleType" AS ENUM ('SIBLING', 'TERM_COMMITMENT', 'PROMO_CODE');

-- CreateTable
CREATE TABLE "discount_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_type" "DiscountRuleType" NOT NULL,
    "program_id" TEXT,
    "percentage" DECIMAL(5,2) NOT NULL,
    "min_weeks" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_rules_tenant_id_idx" ON "discount_rules"("tenant_id");

-- CreateIndex
CREATE INDEX "discount_rules_program_id_idx" ON "discount_rules"("program_id");

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
