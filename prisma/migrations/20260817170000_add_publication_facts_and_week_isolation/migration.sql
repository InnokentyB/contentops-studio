-- TDPD-004/005: canonical publication facts, metric checkpoints, and exact week identity.
-- Additive migration: legacy ContentItem publication fields remain available for rollback.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM planner.week_packages
    GROUP BY project_id, week_start, week_end
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate week package cycles must be reconciled before applying TDPD-005';
  END IF;
END $$;

CREATE UNIQUE INDEX "week_packages_project_id_week_start_week_end_key"
ON planner.week_packages(project_id, week_start, week_end);

CREATE TABLE planner.publication_facts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  artifact_kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  public_url TEXT,
  provider_object_id TEXT,
  confirmation_mode TEXT NOT NULL,
  evidence_type TEXT,
  evidence_ref TEXT,
  target_url TEXT,
  utm_status TEXT NOT NULL DEFAULT 'unknown',
  confirmed_by TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT publication_facts_content_item_id_key UNIQUE (content_item_id),
  CONSTRAINT publication_facts_project_id_fkey FOREIGN KEY (project_id) REFERENCES planner.projects(id) ON DELETE CASCADE,
  CONSTRAINT publication_facts_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES planner.content_items(id) ON DELETE CASCADE,
  CONSTRAINT publication_facts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES planner.social_channels(id) ON DELETE RESTRICT
);

CREATE INDEX publication_facts_project_id_outcome_published_at_idx
ON planner.publication_facts(project_id, outcome, published_at);
CREATE INDEX publication_facts_channel_id_published_at_idx
ON planner.publication_facts(channel_id, published_at);

ALTER TABLE planner.metric_snapshots
  ADD COLUMN scheduled_for TIMESTAMPTZ,
  ADD COLUMN captured_at TIMESTAMPTZ,
  ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN collection_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN evidence_ref TEXT,
  ADD COLUMN error_code TEXT,
  ADD COLUMN error_message TEXT,
  ADD COLUMN late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN window_start TIMESTAMPTZ,
  ADD COLUMN window_end TIMESTAMPTZ;

ALTER TABLE planner.metric_snapshots
  ADD CONSTRAINT metric_snapshots_content_item_id_fkey
  FOREIGN KEY (content_item_id) REFERENCES planner.content_items(id) ON DELETE CASCADE;

-- Backfill only unambiguous published items. Missing timestamps, channels, links,
-- and conflicting JSON outcomes remain untouched for the reconciliation report.
INSERT INTO planner.publication_facts (
  project_id, content_item_id, channel_id, artifact_kind, outcome, published_at,
  public_url, confirmation_mode, evidence_type, evidence_ref, utm_status,
  confirmed_by, confirmed_at
)
SELECT
  ci.project_id,
  ci.id,
  ci.channel_id,
  CASE
    WHEN lower(ci.type) LIKE '%article%' THEN 'article'
    WHEN lower(ci.type) LIKE '%comment%' THEN 'comment'
    WHEN lower(ci.type) LIKE '%email%' THEN 'email'
    ELSE 'post'
  END,
  'published',
  (ci.metrics->>'manual_confirmation_at')::timestamptz,
  ci.published_link,
  'reconciled',
  'public_url',
  ci.published_link,
  'unknown',
  'migration:tdpd-004',
  CURRENT_TIMESTAMP
FROM planner.content_items ci
WHERE ci.status = 'published'
  AND ci.channel_id IS NOT NULL
  AND nullif(ci.published_link, '') IS NOT NULL
  AND (ci.metrics->>'manual_confirmation_at') ~ '^\d{4}-\d{2}-\d{2}T'
  AND COALESCE(ci.metrics->>'publication_outcome', 'published') = 'published'
  AND COALESCE(ci.quality_report->>'publication_outcome', 'published') = 'published'
  AND COALESCE(ci.metrics->>'publication_outcome', 'published') = COALESCE(ci.quality_report->>'publication_outcome', 'published')
ON CONFLICT (content_item_id) DO NOTHING;

INSERT INTO planner.metric_snapshots (
  project_id, content_item_id, channel_id, checkpoint, scheduled_for,
  collection_mode, source, collection_status, metrics, created_at, updated_at
)
SELECT project_id, content_item_id, channel_id, 't24h', published_at + interval '24 hours',
       'manual', 'manual', 'pending', '{"schema_version":1,"values":{}}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM planner.publication_facts
WHERE outcome = 'published'
ON CONFLICT (project_id, content_item_id, channel_id, checkpoint) DO NOTHING;

INSERT INTO planner.metric_snapshots (
  project_id, content_item_id, channel_id, checkpoint, scheduled_for,
  collection_mode, source, collection_status, metrics, created_at, updated_at
)
SELECT project_id, content_item_id, channel_id, 't7d', published_at + interval '7 days',
       'manual', 'manual', 'pending', '{"schema_version":1,"values":{}}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM planner.publication_facts
WHERE outcome = 'published'
ON CONFLICT (project_id, content_item_id, channel_id, checkpoint) DO NOTHING;
