-- Create DeliveryAttempt table
CREATE TABLE IF NOT EXISTS "planner"."delivery_attempts" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "content_item_id" INTEGER NOT NULL,
  "channel_id" INTEGER NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'assisted',
  "status" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT,
  "scheduled_at" TIMESTAMPTZ(6),
  "actual_published_at" TIMESTAMPTZ(6),
  "requires_manual_confirmation" BOOLEAN NOT NULL DEFAULT false,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_attempts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "delivery_attempts_project_id_idx" ON "planner"."delivery_attempts"("project_id");
CREATE INDEX IF NOT EXISTS "delivery_attempts_content_item_id_idx" ON "planner"."delivery_attempts"("content_item_id");
CREATE INDEX IF NOT EXISTS "delivery_attempts_channel_id_idx" ON "planner"."delivery_attempts"("channel_id");
CREATE INDEX IF NOT EXISTS "delivery_attempts_idempotency_key_idx" ON "planner"."delivery_attempts"("idempotency_key");
