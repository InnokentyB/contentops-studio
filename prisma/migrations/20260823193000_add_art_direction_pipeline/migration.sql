ALTER TABLE "planner"."content_items"
    ADD COLUMN "text_state" TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN "accepted_revision" INTEGER,
    ADD COLUMN "visual_state" TEXT NOT NULL DEFAULT 'PENDING_ASSESSMENT',
    ADD COLUMN "handoff_state" TEXT NOT NULL DEFAULT 'blocked',
    ADD COLUMN "visual_mode" TEXT NOT NULL DEFAULT 'auto_assess',
    ADD COLUMN "visual_placement" TEXT,
    ADD COLUMN "visual_decision_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "selected_asset_id" INTEGER;

ALTER TABLE "planner"."work_items" ADD COLUMN "dedupe_key" TEXT;

ALTER TABLE "planner"."image_assets"
    ADD COLUMN "decision_id" INTEGER,
    ADD COLUMN "content_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "placement" TEXT,
    ADD COLUMN "file_url" TEXT,
    ADD COLUMN "provenance" JSONB,
    ADD COLUMN "qa_report" JSONB,
    ADD COLUMN "review_reason" TEXT,
    ADD COLUMN "reviewed_by" TEXT,
    ADD COLUMN "reviewed_at" TIMESTAMP(3);

CREATE TABLE "planner"."art_direction_decisions" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "content_item_id" INTEGER NOT NULL,
    "work_item_id" INTEGER,
    "decision_version" INTEGER NOT NULL,
    "source_content_revision" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "visual_function" TEXT,
    "reason" TEXT NOT NULL,
    "post_owns" TEXT,
    "visual_adds" TEXT,
    "loss_without_visual" TEXT,
    "authenticity_class" TEXT,
    "evidence_refs" JSONB,
    "visual_format" TEXT,
    "dimensions" JSONB,
    "required_text" JSONB,
    "forbidden_text" JSONB,
    "visible_copy_budget" INTEGER,
    "prompt" TEXT,
    "alt_text" TEXT,
    "acceptance_criteria" JSONB,
    "recent_asset_refs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "art_direction_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_items_dedupe_key_key" ON "planner"."work_items"("dedupe_key");
CREATE INDEX "content_items_visual_state_idx" ON "planner"."content_items"("visual_state");
CREATE INDEX "content_items_selected_asset_id_idx" ON "planner"."content_items"("selected_asset_id");
CREATE INDEX "image_assets_decision_id_idx" ON "planner"."image_assets"("decision_id");
CREATE UNIQUE INDEX "art_direction_decisions_content_item_id_source_content_re_key"
    ON "planner"."art_direction_decisions"("content_item_id", "source_content_revision", "placement", "decision_version");
CREATE INDEX "art_direction_decisions_project_id_status_idx" ON "planner"."art_direction_decisions"("project_id", "status");
CREATE INDEX "art_direction_decisions_content_item_id_status_idx" ON "planner"."art_direction_decisions"("content_item_id", "status");

ALTER TABLE "planner"."content_items"
    ADD CONSTRAINT "content_items_selected_asset_id_fkey"
    FOREIGN KEY ("selected_asset_id") REFERENCES "planner"."image_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planner"."image_assets"
    ADD CONSTRAINT "image_assets_content_item_id_fkey"
    FOREIGN KEY ("content_item_id") REFERENCES "planner"."content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "planner"."image_assets"
    ADD CONSTRAINT "image_assets_decision_id_fkey"
    FOREIGN KEY ("decision_id") REFERENCES "planner"."art_direction_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planner"."art_direction_decisions"
    ADD CONSTRAINT "art_direction_decisions_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."art_direction_decisions"
    ADD CONSTRAINT "art_direction_decisions_content_item_id_fkey"
    FOREIGN KEY ("content_item_id") REFERENCES "planner"."content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
