-- ─────────────────────────────────────────────────────────────────────────────
-- Allocator foundation
--
-- Purpose: introduce race-safe enrolment allocation and atomic tenant-scoped
-- ID generation. This migration is intentionally ADDITIVE ONLY — no DROP or
-- ALTER on tables owned by the shared tenant-management repo.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Atomic counter table.
--    cm_ prefix marks ownership by the Club Manager repo, to coexist with
--    tables created by the tenant-management repo that shares this database.
CREATE TABLE IF NOT EXISTS "cm_tenant_counters" (
  "tenant_id"   text    NOT NULL,
  "counter_key" text    NOT NULL,
  "next_value"  integer NOT NULL DEFAULT 0,
  CONSTRAINT "cm_tenant_counters_pkey" PRIMARY KEY ("tenant_id", "counter_key")
);

-- 2. Seed the 'participant' counter from the existing participants table so
--    newly generated IDs continue from where the legacy `count + 1` logic
--    left off. We count ALL rows (including soft-deleted) because the
--    @@unique([tenantId, uniqueId]) constraint covers deleted rows too.
INSERT INTO "cm_tenant_counters" ("tenant_id", "counter_key", "next_value")
SELECT "tenant_id", 'participant', COUNT(*)
FROM "participants"
GROUP BY "tenant_id"
ON CONFLICT ("tenant_id", "counter_key") DO NOTHING;

-- 3. Partial unique index on waitlist (session_id, location_id, position) for
--    non-soft-deleted rows. Acts as a safety net against position collisions
--    even if a future code path skips the allocator.
--
--    Restricted to deleted_at IS NULL so positions belonging to withdrawn or
--    promoted entries can be reused by later FIFO promotions.
--
--    IF THIS MIGRATION FAILS HERE, existing active waitlist data contains
--    duplicate positions. Use the cleanup query below to renumber, then
--    re-run `prisma migrate dev`:
--
--      WITH ranked AS (
--        SELECT id, ROW_NUMBER() OVER (
--          PARTITION BY session_id, location_id
--          ORDER BY position, created_at, id
--        ) AS new_pos
--        FROM waitlist
--        WHERE deleted_at IS NULL
--      )
--      UPDATE waitlist
--      SET position = ranked.new_pos
--      FROM ranked
--      WHERE waitlist.id = ranked.id;
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_session_location_position_active_key"
  ON "waitlist" ("session_id", "location_id", "position")
  WHERE "deleted_at" IS NULL;
