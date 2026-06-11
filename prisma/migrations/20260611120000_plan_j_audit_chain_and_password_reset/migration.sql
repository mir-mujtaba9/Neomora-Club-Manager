-- Plan J (F-32 + F-33) — additive migration:
--   1. NotificationType.PASSWORD_RESET enum value (safe re-runnable ADD VALUE).
--   2. audit_logs.hash_self / hash_prev columns for tamper-evident chain.
--   3. password_reset_tokens table.

-- ─── 1. PASSWORD_RESET notification type ────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';

-- ─── 2. AuditLog hash chain columns ─────────────────────────────────────
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "hash_self" TEXT,
  ADD COLUMN IF NOT EXISTS "hash_prev" TEXT;

-- ─── 3. password_reset_tokens table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key"
    ON "password_reset_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_created_at_idx"
    ON "password_reset_tokens"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_at_idx"
    ON "password_reset_tokens"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE "password_reset_tokens"
      ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
