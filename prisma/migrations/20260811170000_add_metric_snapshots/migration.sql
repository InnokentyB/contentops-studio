-- Create MetricSnapshot table
CREATE TABLE IF NOT EXISTS "planner"."metric_snapshots" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "content_item_id" INTEGER NOT NULL,
  "channel_id" INTEGER NOT NULL,
  "checkpoint" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "metric_snapshots_project_id_content_item_id_channel_id_checkpoint_key" ON "planner"."metric_snapshots"("project_id", "content_item_id", "channel_id", "checkpoint");
CREATE INDEX IF NOT EXISTS "metric_snapshots_project_id_idx" ON "planner"."metric_snapshots"("project_id");
CREATE INDEX IF NOT EXISTS "metric_snapshots_content_item_id_idx" ON "planner"."metric_snapshots"("content_item_id");
