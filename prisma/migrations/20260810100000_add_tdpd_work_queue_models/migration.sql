CREATE SCHEMA IF NOT EXISTS "planner";

-- CreateTable week_packages
CREATE TABLE IF NOT EXISTS "planner"."week_packages" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "month_arc_id" INTEGER,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "week_theme" TEXT,
    "core_thesis" TEXT,
    "audience_focus" TEXT,
    "intent_tag" TEXT,
    "monetization_tie" TEXT,
    "narrative_arc" JSONB,
    "cross_links" JSONB,
    "risks" JSONB,
    "channel_mix" JSONB,
    "plan_id" TEXT,
    "plan_version" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "approval_status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "week_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable content_items
CREATE TABLE IF NOT EXISTS "planner"."content_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "week_package_id" INTEGER,
    "channel_id" INTEGER,
    "type" TEXT NOT NULL,
    "layer" TEXT,
    "title" TEXT,
    "brief" TEXT,
    "key_points" JSONB,
    "cta" TEXT,
    "cross_link_to" JSONB,
    "assets" JSONB,
    "draft_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "schedule_at" TIMESTAMPTZ(6),
    "quality_report" JSONB,
    "metrics" JSONB,
    "telegram_message_id" INTEGER,
    "published_link" TEXT,
    "item_key" TEXT,
    "content_due_at" TIMESTAMPTZ(6),
    "publish_at" TIMESTAMPTZ(6),
    "review_policy" TEXT,
    "publication_mode" TEXT DEFAULT 'manual_handoff',
    "source_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable week_packages
ALTER TABLE "planner"."week_packages" ADD COLUMN IF NOT EXISTS "plan_id" TEXT,
ADD COLUMN IF NOT EXISTS "plan_version" TEXT,
ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'UTC';

-- AlterTable content_items
ALTER TABLE "planner"."content_items" ADD COLUMN IF NOT EXISTS "item_key" TEXT,
ADD COLUMN IF NOT EXISTS "content_due_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "publish_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "review_policy" TEXT,
ADD COLUMN IF NOT EXISTS "publication_mode" TEXT DEFAULT 'manual_handoff',
ADD COLUMN IF NOT EXISTS "source_refs" JSONB;

-- CreateTable work_items
CREATE TABLE IF NOT EXISTS "planner"."work_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "week_package_id" INTEGER,
    "content_item_id" INTEGER,
    "item_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "assignee_role" TEXT NOT NULL,
    "depends_on_item_id" INTEGER,
    "due_at" TIMESTAMPTZ(6),
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "lease_actor_id" TEXT,
    "input_context_version" INTEGER NOT NULL DEFAULT 1,
    "result_version" INTEGER NOT NULL DEFAULT 0,
    "result_payload" JSONB,
    "reason_code" TEXT,
    "note" TEXT,
    "missing_resource_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable approval_decisions
CREATE TABLE IF NOT EXISTS "planner"."approval_decisions" (
    "id" SERIAL NOT NULL,
    "work_item_id" INTEGER NOT NULL,
    "result_version" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "comment" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable workflow_events
CREATE TABLE IF NOT EXISTS "planner"."workflow_events" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "work_item_id" INTEGER,
    "week_package_id" INTEGER,
    "content_item_id" INTEGER,
    "actor_id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "work_items_project_id_idx" ON "planner"."work_items"("project_id");
CREATE INDEX IF NOT EXISTS "work_items_week_package_id_idx" ON "planner"."work_items"("week_package_id");
CREATE INDEX IF NOT EXISTS "work_items_content_item_id_idx" ON "planner"."work_items"("content_item_id");
CREATE INDEX IF NOT EXISTS "work_items_state_idx" ON "planner"."work_items"("state");
CREATE INDEX IF NOT EXISTS "work_items_kind_idx" ON "planner"."work_items"("kind");
CREATE INDEX IF NOT EXISTS "work_items_due_at_idx" ON "planner"."work_items"("due_at");

CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_idempotency_key_key" ON "planner"."approval_decisions"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_work_item_id_result_version_key" ON "planner"."approval_decisions"("work_item_id", "result_version");
CREATE INDEX IF NOT EXISTS "approval_decisions_work_item_id_idx" ON "planner"."approval_decisions"("work_item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_events_idempotency_key_key" ON "planner"."workflow_events"("idempotency_key");
CREATE INDEX IF NOT EXISTS "workflow_events_project_id_idx" ON "planner"."workflow_events"("project_id");
CREATE INDEX IF NOT EXISTS "workflow_events_work_item_id_idx" ON "planner"."workflow_events"("work_item_id");

-- Foreign Keys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_project_id_fkey') THEN
        ALTER TABLE "planner"."work_items" ADD CONSTRAINT "work_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_week_package_id_fkey') THEN
        ALTER TABLE "planner"."work_items" ADD CONSTRAINT "work_items_week_package_id_fkey" FOREIGN KEY ("week_package_id") REFERENCES "planner"."week_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_content_item_id_fkey') THEN
        ALTER TABLE "planner"."work_items" ADD CONSTRAINT "work_items_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "planner"."content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_decisions_work_item_id_fkey') THEN
        ALTER TABLE "planner"."approval_decisions" ADD CONSTRAINT "approval_decisions_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "planner"."work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_events_project_id_fkey') THEN
        ALTER TABLE "planner"."workflow_events" ADD CONSTRAINT "workflow_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_events_work_item_id_fkey') THEN
        ALTER TABLE "planner"."workflow_events" ADD CONSTRAINT "workflow_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "planner"."work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_events_week_package_id_fkey') THEN
        ALTER TABLE "planner"."workflow_events" ADD CONSTRAINT "workflow_events_week_package_id_fkey" FOREIGN KEY ("week_package_id") REFERENCES "planner"."week_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_events_content_item_id_fkey') THEN
        ALTER TABLE "planner"."workflow_events" ADD CONSTRAINT "workflow_events_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "planner"."content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
