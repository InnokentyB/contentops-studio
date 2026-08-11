-- Add tracker tracking fields to WorkItem
ALTER TABLE "planner"."work_items"
  ADD COLUMN IF NOT EXISTS "tracker_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "tracker_project_id" TEXT,
  ADD COLUMN IF NOT EXISTS "tracker_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "tracker_url" TEXT,
  ADD COLUMN IF NOT EXISTS "sync_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "sync_status" TEXT,
  ADD COLUMN IF NOT EXISTS "sync_error" TEXT;

-- Create OutboxEvent table
CREATE TABLE IF NOT EXISTS "planner"."outbox_events" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "work_item_id" INTEGER,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sync_version" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outbox_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "planner"."work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "outbox_events_project_id_idx" ON "planner"."outbox_events"("project_id");
CREATE INDEX IF NOT EXISTS "outbox_events_status_idx" ON "planner"."outbox_events"("status");
CREATE INDEX IF NOT EXISTS "outbox_events_idempotency_key_idx" ON "planner"."outbox_events"("idempotency_key");

-- Create WebhookInbox table
CREATE TABLE IF NOT EXISTS "planner"."webhook_inbox" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_inbox_event_id_key" UNIQUE ("event_id"),
  CONSTRAINT "webhook_inbox_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "webhook_inbox_project_id_idx" ON "planner"."webhook_inbox"("project_id");
CREATE INDEX IF NOT EXISTS "webhook_inbox_event_id_idx" ON "planner"."webhook_inbox"("event_id");
