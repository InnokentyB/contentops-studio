-- Delta017 compatibility readers must be deployed before any new host mode is written.
-- This schema capability grants no permission. All runtime guards default NOT_CHECKED.
-- Rollback stops provider execution and retains compatible readers, jobs, leases and audit.
BEGIN;
ALTER TABLE planner.connector_dispatch_jobs
  ADD COLUMN canonical_lease_sha256 TEXT CHECK (canonical_lease_sha256 IS NULL OR canonical_lease_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN canonical_lease_expires_at TIMESTAMPTZ(6);
COMMIT;
