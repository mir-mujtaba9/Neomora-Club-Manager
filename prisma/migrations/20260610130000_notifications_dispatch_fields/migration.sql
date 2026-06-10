-- ============================================================================
-- Notifications: additive columns + STAFF_ALERT enum value
-- ============================================================================
-- Plan C foundation. We use the existing `notifications` table (owned by
-- Club Manager, NOT tenant-management) and extend it with the fields needed
-- to actually render + dispatch messages:
--
--   * recipient_user_id  – for STAFF_ALERT notifications (admins)
--   * recipient_phone    – snapshot at enqueue time (guardian phone may change)
--   * recipient_email    – snapshot at enqueue time
--   * body_text          – rendered message body (locale-aware)
--   * dedupe_key         – idempotency guard; partial-unique per tenant
--   * failure_reason     – last error message from the channel
--
-- All columns are NULLABLE so existing rows (currently zero in production)
-- continue to satisfy NOT NULL constraints.
--
-- Safety:
--   * Every statement is idempotent (IF NOT EXISTS / IF EXISTS guards).
--   * No data is rewritten.
--   * Enum addition is forward-only and supported by PG 12+.
--   * Foreign key targets the shared `users` table with ON DELETE SET NULL
--     so a tenant-mgmt-side user removal does not orphan or cascade-delete
--     our audit trail of notifications.
-- ============================================================================

-- 1. Add the STAFF_ALERT value to the existing NotificationType enum.
--    PG 12+ supports IF NOT EXISTS for ADD VALUE; safe to re-run.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STAFF_ALERT';

-- 2. Extend the notifications table with the dispatch payload + audit fields.
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "recipient_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_phone"   TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_email"   TEXT,
  ADD COLUMN IF NOT EXISTS "body_text"         TEXT,
  ADD COLUMN IF NOT EXISTS "dedupe_key"        TEXT,
  ADD COLUMN IF NOT EXISTS "failure_reason"    TEXT;

-- 3. FK to users(id). ON DELETE SET NULL preserves the notification record
--    even if the targeted admin user is deleted. Wrapped in a DO block so
--    the migration is replayable without "constraint already exists" errors.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notifications_recipient_user_id_fkey'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_recipient_user_id_fkey"
      FOREIGN KEY ("recipient_user_id")
      REFERENCES "users"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Idempotency: prevent a duplicate enqueue of the same logical
--    notification (e.g., if the caller retries on a network blip).
--    Partial index because dedupe_key is optional for callers that
--    don't care about idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_tenant_dedupe_key"
  ON "notifications" ("tenant_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

-- 5. Lookup index for "show me my notifications" admin views.
CREATE INDEX IF NOT EXISTS "notifications_recipient_user_id_idx"
  ON "notifications" ("recipient_user_id")
  WHERE "recipient_user_id" IS NOT NULL;
