-- Drop old single-column global unique indexes
DROP INDEX IF EXISTS "planner"."approval_decisions_idempotency_key_key";
DROP INDEX IF EXISTS "planner"."workflow_events_idempotency_key_key";

-- Create new composite unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_work_item_id_actor_id_idempotency_key_key" ON "planner"."approval_decisions"("work_item_id", "actor_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_events_project_id_actor_id_command_idempotency_key_key" ON "planner"."workflow_events"("project_id", "actor_id", "command", "idempotency_key");

-- Create lookup indexes on idempotency_key column
CREATE INDEX IF NOT EXISTS "approval_decisions_idempotency_key_idx" ON "planner"."approval_decisions"("idempotency_key");
CREATE INDEX IF NOT EXISTS "workflow_events_idempotency_key_idx" ON "planner"."workflow_events"("idempotency_key");
