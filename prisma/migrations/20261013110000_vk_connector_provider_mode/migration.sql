-- Apply only after deployment of compatible mode/state readers.
-- Default remains infrastructure_only; this capability grants no provider permission.
BEGIN;
ALTER TABLE planner.connector_host_status DROP CONSTRAINT connector_host_status_mode_check;
ALTER TABLE planner.connector_host_status ADD CONSTRAINT connector_host_status_mode_check
  CHECK (mode IN ('infrastructure_only','vk_feed_provider'));
COMMIT;
