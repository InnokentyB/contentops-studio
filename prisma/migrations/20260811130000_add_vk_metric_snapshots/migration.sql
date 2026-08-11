CREATE TABLE "planner"."vk_metric_snapshots" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "content_item_id" INTEGER NOT NULL,
    "owner_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "logical_date" DATE NOT NULL,
    "collection_mode" TEXT NOT NULL DEFAULT 'automatic',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wall_status" TEXT NOT NULL,
    "reach_status" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "reposts" INTEGER,
    "reach_total" INTEGER,
    "reach_subscribers" INTEGER,
    "reach_viral" INTEGER,
    "reach_ads" INTEGER,
    "link_clicks" INTEGER,
    "group_clicks" INTEGER,
    "group_joins" INTEGER,
    "hides" INTEGER,
    "reports" INTEGER,
    "unsubscribes" INTEGER,
    "provider_error_code" TEXT,
    "provider_error_message" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vk_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vk_metric_snapshots_content_item_id_logical_date_collec_key"
ON "planner"."vk_metric_snapshots"("content_item_id", "logical_date", "collection_mode");

CREATE INDEX "vk_metric_snapshots_project_id_logical_date_idx"
ON "planner"."vk_metric_snapshots"("project_id", "logical_date");

CREATE INDEX "vk_metric_snapshots_channel_id_logical_date_idx"
ON "planner"."vk_metric_snapshots"("channel_id", "logical_date");

CREATE INDEX "vk_metric_snapshots_owner_id_post_id_idx"
ON "planner"."vk_metric_snapshots"("owner_id", "post_id");

ALTER TABLE "planner"."vk_metric_snapshots"
ADD CONSTRAINT "vk_metric_snapshots_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "planner"."vk_metric_snapshots"
ADD CONSTRAINT "vk_metric_snapshots_channel_id_fkey"
FOREIGN KEY ("channel_id") REFERENCES "planner"."social_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "planner"."vk_metric_snapshots"
ADD CONSTRAINT "vk_metric_snapshots_content_item_id_fkey"
FOREIGN KEY ("content_item_id") REFERENCES "planner"."content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
