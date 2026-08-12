CREATE SCHEMA IF NOT EXISTS "planner";

-- Baseline tables predate the work-queue migration but were previously created
-- outside Prisma migration history. IF NOT EXISTS keeps upgrades non-destructive.
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
    "approval_status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "week_packages_pkey" PRIMARY KEY ("id")
);

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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);
