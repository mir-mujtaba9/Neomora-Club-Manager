-- Plan H — Add GUARDIAN_MAGIC_LINK to NotificationType for the portal
-- magic-link delivery flow. ADD VALUE IF NOT EXISTS is safe to re-run.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'GUARDIAN_MAGIC_LINK';
