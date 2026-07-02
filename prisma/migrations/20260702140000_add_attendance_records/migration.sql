-- CreateTable: attendance_records
-- One row per participant per calendar date per session.
-- `present = true`  → attended
-- `present = false` → absent
-- The unique index prevents duplicate records and enables idempotent upserts.

CREATE TABLE "attendance_records" (
    "id"             TEXT          NOT NULL,
    "tenant_id"      TEXT          NOT NULL,
    "participant_id" TEXT          NOT NULL,
    "session_id"     TEXT          NOT NULL,
    "location_id"    TEXT          NOT NULL,
    "marked_by_id"   TEXT          NOT NULL,
    "date"           DATE          NOT NULL,
    "present"        BOOLEAN       NOT NULL DEFAULT true,
    "note"           TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex: one record per participant per session per date
CREATE UNIQUE INDEX "attendance_records_tenant_id_participant_id_session_id_date_key"
    ON "attendance_records"("tenant_id", "participant_id", "session_id", "date");

-- Index: supports list queries scoped by tenant+session+location+date
CREATE INDEX "attendance_records_tenant_id_session_id_location_id_date_idx"
    ON "attendance_records"("tenant_id", "session_id", "location_id", "date");

-- ForeignKey: tenant
ALTER TABLE "attendance_records"
    ADD CONSTRAINT "attendance_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForeignKey: participant
ALTER TABLE "attendance_records"
    ADD CONSTRAINT "attendance_records_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForeignKey: session
ALTER TABLE "attendance_records"
    ADD CONSTRAINT "attendance_records_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForeignKey: location
ALTER TABLE "attendance_records"
    ADD CONSTRAINT "attendance_records_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForeignKey: markedBy (user)
ALTER TABLE "attendance_records"
    ADD CONSTRAINT "attendance_records_marked_by_id_fkey"
    FOREIGN KEY ("marked_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
