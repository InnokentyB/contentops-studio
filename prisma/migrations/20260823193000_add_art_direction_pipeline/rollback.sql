-- Emergency rollback for 20260823193000_add_art_direction_pipeline.
-- Run only after disabling art_direction_pipeline_enabled for every project.
BEGIN;

DELETE FROM planner.project_settings WHERE key = 'art_direction_pipeline_enabled';

ALTER TABLE planner.content_items DROP CONSTRAINT IF EXISTS content_items_selected_asset_id_fkey;
ALTER TABLE planner.image_assets DROP CONSTRAINT IF EXISTS image_assets_decision_id_fkey;
ALTER TABLE planner.image_assets DROP CONSTRAINT IF EXISTS image_assets_content_item_id_fkey;
DROP TABLE IF EXISTS planner.art_direction_decisions;

DROP INDEX IF EXISTS planner.work_items_dedupe_key_key;
ALTER TABLE planner.work_items DROP COLUMN IF EXISTS dedupe_key;

ALTER TABLE planner.image_assets
    DROP COLUMN IF EXISTS decision_id,
    DROP COLUMN IF EXISTS content_revision,
    DROP COLUMN IF EXISTS placement,
    DROP COLUMN IF EXISTS file_url,
    DROP COLUMN IF EXISTS provenance,
    DROP COLUMN IF EXISTS qa_report,
    DROP COLUMN IF EXISTS review_reason,
    DROP COLUMN IF EXISTS reviewed_by,
    DROP COLUMN IF EXISTS reviewed_at;

ALTER TABLE planner.content_items
    DROP COLUMN IF EXISTS text_state,
    DROP COLUMN IF EXISTS accepted_revision,
    DROP COLUMN IF EXISTS visual_state,
    DROP COLUMN IF EXISTS handoff_state,
    DROP COLUMN IF EXISTS visual_mode,
    DROP COLUMN IF EXISTS visual_placement,
    DROP COLUMN IF EXISTS visual_decision_version,
    DROP COLUMN IF EXISTS selected_asset_id;

COMMIT;
