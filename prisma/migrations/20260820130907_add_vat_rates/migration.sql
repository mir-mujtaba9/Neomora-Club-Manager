-- CreateTable
CREATE TABLE "vat_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vat_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vat_rates_tenant_id_idx" ON "vat_rates"("tenant_id");

-- CreateIndex
CREATE INDEX "vat_rates_tenant_id_effective_from_idx" ON "vat_rates"("tenant_id", "effective_from" DESC);

-- AddForeignKey
ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
