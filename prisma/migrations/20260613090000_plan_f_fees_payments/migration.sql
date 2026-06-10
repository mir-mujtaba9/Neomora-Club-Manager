-- Plan F — Fees & Payments lifecycle foundation.
--
-- This migration is strictly additive: it adds optional columns to four
-- existing Club-Manager tables, creates two new `cm_`-prefixed tables,
-- and adds a small number of partial indexes. Nothing existing is
-- altered or dropped. All statements are idempotent via IF NOT EXISTS
-- or DO $$ blocks so re-runs against the shared Neon DB are safe.
--
-- Tables owned by tenant-management are NOT touched.

-- ── 1. Enrolment: per-participant fee override (F-09) ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enrolments' AND column_name = 'fee_override'
  ) THEN
    ALTER TABLE "enrolments"
      ADD COLUMN "fee_override" DECIMAL(10,2);
  END IF;
END $$;

-- ── 2. Invoice: instalment tracking (F-12) ───────────────────────────
-- `instalment_no` is 1-indexed; `instalment_total` is the plan size.
-- Both nullable because FULL plans only have a single invoice, which
-- we model as no instalment_no / no total (single-shot).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'instalment_no'
  ) THEN
    ALTER TABLE "invoices"
      ADD COLUMN "instalment_no" INT,
      ADD COLUMN "instalment_total" INT;
  END IF;
END $$;

-- Partial unique guards against duplicate instalment rows under retried
-- plan-generation. Soft-deleted invoices are excluded so a re-issued
-- plan can re-use the same (enrolment_id, instalment_no) slot.
CREATE UNIQUE INDEX IF NOT EXISTS
  "invoices_enrolment_instalment_active_key"
  ON "invoices"("tenant_id", "enrolment_id", "instalment_no")
  WHERE "deleted_at" IS NULL AND "instalment_no" IS NOT NULL;

-- Reminder cron scans by due_date + status.
CREATE INDEX IF NOT EXISTS
  "invoices_due_date_status_idx"
  ON "invoices"("tenant_id", "due_date", "status")
  WHERE "deleted_at" IS NULL;

-- ── 3. Payment: receipt + failure reason (F-18, F-14/15) ─────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'receipt_key'
  ) THEN
    ALTER TABLE "payments"
      ADD COLUMN "receipt_key" TEXT,
      ADD COLUMN "failure_reason" TEXT;
  END IF;
END $$;

-- ── 4. Tenant: default payment gateway (F-14) ────────────────────────
-- Nullable; factory falls back to OFFLINE when unset.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'default_payment_gateway'
  ) THEN
    ALTER TABLE "tenants"
      ADD COLUMN "default_payment_gateway" "PaymentGateway";
  END IF;
END $$;

-- ── 5. cm_payment_reminder_configs — per-tenant reminder schedule (F-17)
-- If a tenant has zero rows here, the code-level defaults [7, 1, 0]
-- are used. Tenants can override by inserting custom (days_before_due,
-- channel) pairs.
CREATE TABLE IF NOT EXISTS "cm_payment_reminder_configs" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "days_before_due"   INT  NOT NULL,
  "channel"           "NotificationChannel" NOT NULL,
  "enabled"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "cm_payment_reminder_configs_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "cm_payment_reminder_configs_days_nonneg"
    CHECK ("days_before_due" >= 0)
);

-- One config row per (tenant, days_before_due, channel) triple.
CREATE UNIQUE INDEX IF NOT EXISTS
  "cm_payment_reminder_configs_unique"
  ON "cm_payment_reminder_configs"("tenant_id", "days_before_due", "channel");

-- ── 6. cm_payment_webhook_events — incoming gateway callbacks (F-14)
-- Distinct from the existing `webhook_events` table, which is for
-- OUTGOING webhooks we publish to tenant systems. This table receives
-- payment-gateway POSTs (Moyasar / PayTabs / HyperPay / OFFLINE manual)
-- and is drained by a cron processor that calls the appropriate
-- gateway strategy.
--
-- `processed` is true once the strategy has interpreted the payload
-- (whether successfully or with a hard error). `signature_valid` is
-- set after HMAC verification; processing continues only if true (or
-- gateway = OFFLINE which has no signature).
CREATE TABLE IF NOT EXISTS "cm_payment_webhook_events" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT,
  "gateway"           "PaymentGateway" NOT NULL,
  "external_event_id" TEXT,
  "payload"           JSONB NOT NULL,
  "headers"           JSONB,
  "signature"         TEXT,
  "signature_valid"   BOOLEAN,
  "processed"         BOOLEAN NOT NULL DEFAULT false,
  "processed_at"      TIMESTAMP,
  "failure_reason"    TEXT,
  "received_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "cm_payment_webhook_events_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);

-- Drainer queries by (processed=false) ordered by received_at.
CREATE INDEX IF NOT EXISTS
  "cm_payment_webhook_events_unprocessed_idx"
  ON "cm_payment_webhook_events"("received_at")
  WHERE "processed" = false;

-- Duplicate detection per gateway (gateways usually retry the same
-- event-id). Partial — null external_event_id (manual records) is
-- allowed to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS
  "cm_payment_webhook_events_external_unique"
  ON "cm_payment_webhook_events"("gateway", "external_event_id")
  WHERE "external_event_id" IS NOT NULL;
