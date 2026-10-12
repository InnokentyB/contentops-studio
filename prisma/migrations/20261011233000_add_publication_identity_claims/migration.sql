-- Add-only migration. Historical publication facts and content remain unchanged.
CREATE TABLE planner.publication_identity_claims (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  canonical_profile TEXT NOT NULL,
  canonical_profile_hash TEXT NOT NULL,
  normalized_body_sha256 TEXT NOT NULL,
  source_identity JSONB NOT NULL,
  source_identity_sha256 TEXT NOT NULL,
  content_revision INTEGER NOT NULL,
  last_boundary TEXT NOT NULL,
  override_key TEXT NOT NULL DEFAULT '',
  duplicate_of_claim_id INTEGER,
  authorization_event_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT publication_identity_claims_project_fk
    FOREIGN KEY (project_id) REFERENCES planner.projects(id) ON DELETE CASCADE,
  CONSTRAINT publication_identity_claims_content_item_fk
    FOREIGN KEY (content_item_id) REFERENCES planner.content_items(id) ON DELETE CASCADE,
  CONSTRAINT publication_identity_claims_channel_fk
    FOREIGN KEY (channel_id) REFERENCES planner.social_channels(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX publication_identity_claims_content_item_id_key
  ON planner.publication_identity_claims(content_item_id);
CREATE UNIQUE INDEX publication_identity_claims_canonical_key
  ON planner.publication_identity_claims(
    project_id, platform, canonical_profile_hash, normalized_body_sha256, override_key
  );
CREATE INDEX publication_identity_claims_lookup_idx
  ON planner.publication_identity_claims(
    project_id, platform, canonical_profile_hash, normalized_body_sha256
  );
CREATE INDEX publication_identity_claims_duplicate_of_idx
  ON planner.publication_identity_claims(duplicate_of_claim_id);
CREATE INDEX publication_identity_claims_authorization_event_idx
  ON planner.publication_identity_claims(authorization_event_id);
