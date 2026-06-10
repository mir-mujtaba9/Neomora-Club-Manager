-- Plan D — Waitlist Lifecycle additions
-- All additive: no existing column or constraint is altered destructively.
-- Safe to re-run (IF NOT EXISTS guards everywhere).

-- 1) Token columns for guardian accept/decline links.
--    Issued when an offer is sent; cleared (or stale via offer_expires_at)
--    once the guardian responds.
ALTER TABLE "waitlist"
  ADD COLUMN IF NOT EXISTS "offer_token"             TEXT,
  ADD COLUMN IF NOT EXISTS "offer_token_expires_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "offer_attempts"          INTEGER NOT NULL DEFAULT 0;

-- 2) Partial unique index on offer_token so the public accept/decline
--    endpoints can resolve a row in one round-trip with no collision risk.
--    Partial (WHERE offer_token IS NOT NULL) keeps soft-deleted / pre-offer
--    rows from blocking new token generation.
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_offer_token_key"
  ON "waitlist" ("offer_token")
  WHERE "offer_token" IS NOT NULL;

-- 3) Helper index for the promotion cron: it scans for active
--    waitlist rows ordered by position within (tenant, session, location).
--    The existing composite (tenant_id, session_id, location_id) index covers
--    the WHERE; adding offer_status partial index for the "is any offer
--    currently outstanding?" lookup.
CREATE INDEX IF NOT EXISTS "waitlist_outstanding_offer_idx"
  ON "waitlist" ("tenant_id", "session_id", "location_id")
  WHERE "offer_status" = 'PENDING'
    AND "offer_sent_at" IS NOT NULL
    AND "deleted_at" IS NULL;

-- 4) Helper index for expireOffers cron: scans rows whose offer is past
--    deadline. Existing offer_expires_at index covers it, but make sure
--    only PENDING rows surface (most rows in steady-state are terminal).
CREATE INDEX IF NOT EXISTS "waitlist_pending_offer_expiry_idx"
  ON "waitlist" ("offer_expires_at")
  WHERE "offer_status" = 'PENDING'
    AND "offer_sent_at" IS NOT NULL
    AND "deleted_at" IS NULL;
