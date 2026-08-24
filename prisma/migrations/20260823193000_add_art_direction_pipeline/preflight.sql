-- Must return zero before deploying the art-direction migration.
SELECT ia.id, ia.content_item_id
FROM planner.image_assets AS ia
LEFT JOIN planner.content_items AS ci ON ci.id = ia.content_item_id
WHERE ci.id IS NULL;

-- Informational only: these projects remain unaffected until explicitly enabled.
SELECT project_id, value
FROM planner.project_settings
WHERE key = 'art_direction_pipeline_enabled';
