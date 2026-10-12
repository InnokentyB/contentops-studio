-- TDPD-016 additive transport lifecycle. No task, lease, attempt or fact is rewritten.
-- Rollback: disable dispatch/consumer and deploy the previous executable; retain these
-- tables and all audit rows. Do not reset queued/uncertain jobs or remove history.
-- Scoped unique indexes permit database-enforced tenant isolation on every reference.
CREATE UNIQUE INDEX "content_items_project_id_id_key" ON planner.content_items(project_id,id);
CREATE UNIQUE INDEX "social_channels_project_id_id_key" ON planner.social_channels(project_id,id);
CREATE UNIQUE INDEX "work_items_project_id_id_key" ON planner.work_items(project_id,id);
CREATE UNIQUE INDEX "image_assets_project_id_id_key" ON planner.image_assets(project_id,id);
CREATE UNIQUE INDEX "delivery_attempts_project_id_id_key" ON planner.delivery_attempts(project_id,id);
CREATE UNIQUE INDEX "publication_facts_project_id_id_key" ON planner.publication_facts(project_id,id);

CREATE TABLE planner.connector_dispatch_jobs (
  id UUID PRIMARY KEY,
  project_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  work_item_id INTEGER NOT NULL,
  content_revision INTEGER NOT NULL CHECK (content_revision > 0),
  selected_asset_id INTEGER NOT NULL,
  package_sha256 TEXT NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  binding JSONB NOT NULL CHECK (
    jsonb_typeof(binding) = 'object'
    AND binding ?& ARRAY['projectId','taskId','channelId','revision','selectedAssetId','communityId','placement','bodySha256','assetSha256','releaseSha256']
    AND (binding - ARRAY['projectId','taskId','channelId','revision','selectedAssetId','communityId','placement','bodySha256','assetSha256','releaseSha256']) = '{}'::jsonb
    AND jsonb_typeof(binding->'projectId') = 'number'
    AND jsonb_typeof(binding->'taskId') = 'number'
    AND jsonb_typeof(binding->'channelId') = 'number'
    AND jsonb_typeof(binding->'revision') = 'number'
    AND jsonb_typeof(binding->'selectedAssetId') = 'number'
    AND jsonb_typeof(binding->'communityId') = 'number'
    AND (binding->>'projectId')::INTEGER = project_id
    AND (binding->>'taskId')::INTEGER = content_item_id
    AND (binding->>'channelId')::INTEGER = channel_id
    AND (binding->>'revision')::INTEGER = content_revision
    AND (binding->>'selectedAssetId')::INTEGER = selected_asset_id
    AND (binding->>'communityId')::BIGINT < 0
    AND jsonb_typeof(binding->'placement') = 'string'
    AND jsonb_typeof(binding->'bodySha256') = 'string'
    AND jsonb_typeof(binding->'assetSha256') = 'string'
    AND jsonb_typeof(binding->'releaseSha256') = 'string'
    AND binding->>'placement' IN ('feed','article_cover','video_cover','story','clip')
    AND binding->>'bodySha256' ~ '^[a-f0-9]{64}$'
    AND binding->>'assetSha256' ~ '^[a-f0-9]{64}$'
    AND binding->>'releaseSha256' ~ '^[a-f0-9]{64}$'
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN
    ('queued','accepted','reconciling','ready','executing','confirmed','blocked','verification_required','cancelled')),
  host_id TEXT,
  consumer_instance_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  receipt_at TIMESTAMPTZ(6),
  blocker_code TEXT,
  attempt_id INTEGER,
  publication_fact_id INTEGER,
  CONSTRAINT connector_dispatch_jobs_confirmed_fact_check CHECK (state <> 'confirmed' OR publication_fact_id IS NOT NULL),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT connector_dispatch_jobs_package_key UNIQUE
    (project_id,content_item_id,channel_id,content_revision,package_sha256),
  CONSTRAINT connector_dispatch_jobs_project_id_idempotency_key_key UNIQUE (project_id,idempotency_key),
  CONSTRAINT connector_dispatch_jobs_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES planner.projects(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_content_item_id_fkey FOREIGN KEY (project_id,content_item_id)
    REFERENCES planner.content_items(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_channel_id_fkey FOREIGN KEY (project_id,channel_id)
    REFERENCES planner.social_channels(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_work_item_id_fkey FOREIGN KEY (project_id,work_item_id)
    REFERENCES planner.work_items(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_selected_asset_id_fkey FOREIGN KEY (project_id,selected_asset_id)
    REFERENCES planner.image_assets(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_attempt_id_fkey FOREIGN KEY (project_id,attempt_id)
    REFERENCES planner.delivery_attempts(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connector_dispatch_jobs_project_id_publication_fact_id_fkey FOREIGN KEY (project_id,publication_fact_id)
    REFERENCES planner.publication_facts(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX connector_dispatch_jobs_project_id_state_created_at_idx
  ON planner.connector_dispatch_jobs(project_id,state,created_at);
CREATE INDEX connector_dispatch_jobs_host_instance_idx
  ON planner.connector_dispatch_jobs(project_id,host_id,consumer_instance_id);

CREATE TABLE planner.connector_host_status (
  project_id INTEGER NOT NULL,
  host_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  build_version TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ(6) NOT NULL,
  mode TEXT NOT NULL DEFAULT 'infrastructure_only' CHECK (mode = 'infrastructure_only'),
  blocker_code TEXT,
  CONSTRAINT connector_host_status_pkey PRIMARY KEY(project_id,host_id),
  CONSTRAINT connector_host_status_project_id_fkey FOREIGN KEY(project_id)
    REFERENCES planner.projects(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX connector_host_status_project_id_heartbeat_at_idx
  ON planner.connector_host_status(project_id,heartbeat_at);
