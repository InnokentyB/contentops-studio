-- TDPD-007 Slice A: organization tenant and intelligence data foundation.
-- Project.organization_id deliberately remains nullable during the compatibility window.

CREATE TABLE IF NOT EXISTS "planner"."organizations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "planner"."organizations"("slug");
CREATE INDEX IF NOT EXISTS "organizations_is_archived_idx" ON "planner"."organizations"("is_archived");

CREATE TABLE IF NOT EXISTS "planner"."organization_members" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_members_role_check" CHECK ("role" IN ('owner', 'researcher', 'viewer')),
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_id_user_id_key" ON "planner"."organization_members"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "organization_members_user_id_role_idx" ON "planner"."organization_members"("user_id", "role");

ALTER TABLE "planner"."projects" ADD COLUMN IF NOT EXISTS "organization_id" INTEGER;
CREATE INDEX IF NOT EXISTS "projects_organization_id_is_archived_idx" ON "planner"."projects"("organization_id", "is_archived");

-- MCP credentials remain project-compatible while adding a mutually exclusive organization scope.
ALTER TABLE "planner"."mcp_access_tokens"
    ALTER COLUMN "project_id" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "organization_id" INTEGER;
ALTER TABLE "planner"."mcp_access_tokens" DROP CONSTRAINT IF EXISTS "mcp_access_tokens_exactly_one_scope_check";
ALTER TABLE "planner"."mcp_access_tokens"
    ADD CONSTRAINT "mcp_access_tokens_exactly_one_scope_check" CHECK (("project_id" IS NOT NULL) <> ("organization_id" IS NOT NULL));
ALTER TABLE "planner"."mcp_access_tokens" DROP CONSTRAINT IF EXISTS "mcp_access_tokens_profile_check";
ALTER TABLE "planner"."mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_profile_check"
    CHECK ("profile" IN ('strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst', 'organization_researcher'));
CREATE INDEX IF NOT EXISTS "mcp_access_tokens_organization_id_profile_idx" ON "planner"."mcp_access_tokens"("organization_id", "profile");

-- Backfill only projects with exactly one owner. One personal organization is shared by all
-- unambiguously-owned projects of that user. Projects with zero/multiple owners stay NULL.
WITH unambiguous_owners AS (
    SELECT pm."project_id", MIN(pm."user_id") AS "user_id"
    FROM "planner"."project_members" pm
    WHERE pm."role" = 'owner'
    GROUP BY pm."project_id"
    HAVING COUNT(*) = 1
), owner_users AS (
    SELECT DISTINCT "user_id" FROM unambiguous_owners
)
INSERT INTO "planner"."organizations" ("name", "slug", "updated_at")
SELECT COALESCE(NULLIF(BTRIM(u."name"), ''), 'Personal workspace') || '''s organization',
       'personal-user-' || u."id"::text,
       CURRENT_TIMESTAMP
FROM "planner"."users" u
JOIN owner_users ou ON ou."user_id" = u."id"
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "planner"."organization_members" ("organization_id", "user_id", "role", "updated_at")
SELECT o."id", uo."user_id", 'owner', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "user_id" FROM (
    SELECT pm."project_id", MIN(pm."user_id") AS "user_id"
    FROM "planner"."project_members" pm
    WHERE pm."role" = 'owner'
    GROUP BY pm."project_id"
    HAVING COUNT(*) = 1
) owners) uo
JOIN "planner"."organizations" o ON o."slug" = 'personal-user-' || uo."user_id"::text
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

WITH unambiguous_owners AS (
    SELECT pm."project_id", MIN(pm."user_id") AS "user_id"
    FROM "planner"."project_members" pm
    WHERE pm."role" = 'owner'
    GROUP BY pm."project_id"
    HAVING COUNT(*) = 1
)
UPDATE "planner"."projects" p
SET "organization_id" = o."id"
FROM unambiguous_owners uo
JOIN "planner"."organizations" o ON o."slug" = 'personal-user-' || uo."user_id"::text
WHERE p."id" = uo."project_id" AND p."organization_id" IS NULL;

CREATE TABLE "planner"."research_connections" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encrypted_config" TEXT,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_connections_capabilities_check" CHECK ("capabilities" <@ ARRAY['search', 'read', 'monitor']::TEXT[]),
    CONSTRAINT "research_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_connections_organization_id_source_type_name_key" ON "planner"."research_connections"("organization_id", "source_type", "name");
CREATE INDEX "research_connections_organization_id_source_type_is_active_idx" ON "planner"."research_connections"("organization_id", "source_type", "is_active");

INSERT INTO "planner"."research_connections" ("organization_id", "source_type", "name", "capabilities", "updated_at")
SELECT o."id", source."source_type", source."name", ARRAY['search', 'read']::TEXT[], CURRENT_TIMESTAMP
FROM "planner"."organizations" o
CROSS JOIN (VALUES ('reddit', 'Reddit'), ('indie_hackers', 'Indie Hackers')) AS source("source_type", "name")
ON CONFLICT ("organization_id", "source_type", "name") DO NOTHING;

CREATE TABLE "planner"."project_research_profiles" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "audience" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "problems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "competitors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "include_terms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exclude_terms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "geographies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source_weights" JSONB,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_research_profiles_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "project_research_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_research_profiles_project_id_key" ON "planner"."project_research_profiles"("project_id");
CREATE INDEX "project_research_profiles_updated_by_idx" ON "planner"."project_research_profiles"("updated_by");

INSERT INTO "planner"."project_research_profiles" ("project_id", "revision", "updated_at")
SELECT p."id", 1, CURRENT_TIMESTAMP
FROM "planner"."projects" p
WHERE p."organization_id" IS NOT NULL
ON CONFLICT ("project_id") DO NOTHING;

CREATE TABLE "planner"."research_runs" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalized_query" TEXT NOT NULL,
    "requested_sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "project_scope_snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "source_outcomes" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT,
    "adapter_versions" JSONB,
    "retry_of_id" INTEGER,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "deduplicated_count" INTEGER NOT NULL DEFAULT 0,
    "assessed_count" INTEGER NOT NULL DEFAULT 0,
    "routed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_runs_status_check" CHECK ("status" IN ('queued', 'running', 'partial', 'completed', 'failed')),
    CONSTRAINT "research_runs_counts_check" CHECK ("fetched_count" >= 0 AND "deduplicated_count" >= 0 AND "assessed_count" >= 0 AND "routed_count" >= 0),
    CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_runs_organization_id_actor_id_idempotency_key_key" ON "planner"."research_runs"("organization_id", "actor_id", "idempotency_key");
CREATE INDEX "research_runs_organization_id_status_created_at_idx" ON "planner"."research_runs"("organization_id", "status", "created_at");
CREATE INDEX "research_runs_retry_of_id_idx" ON "planner"."research_runs"("retry_of_id");

CREATE TABLE "planner"."source_signals" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "provider_object_id" TEXT,
    "canonical_url" TEXT,
    "normalized_url_hash" TEXT,
    "title" TEXT,
    "excerpt" TEXT,
    "author_identity" TEXT,
    "source_published_at" TIMESTAMPTZ(6),
    "first_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provenance" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "access_classification" TEXT NOT NULL DEFAULT 'public',
    "normalized_metadata" JSONB,
    "untrusted_external_content" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_signals_identity_check" CHECK ("provider_object_id" IS NOT NULL OR "normalized_url_hash" IS NOT NULL),
    CONSTRAINT "source_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_signals_organization_id_source_type_provider_object_key" ON "planner"."source_signals"("organization_id", "source_type", "provider_object_id");
CREATE UNIQUE INDEX "source_signals_organization_id_source_type_normalized_url_key" ON "planner"."source_signals"("organization_id", "source_type", "normalized_url_hash");
CREATE INDEX "source_signals_organization_id_last_observed_at_idx" ON "planner"."source_signals"("organization_id", "last_observed_at");

CREATE TABLE "planner"."research_run_signals" (
    "id" SERIAL NOT NULL,
    "research_run_id" INTEGER NOT NULL,
    "signal_id" INTEGER NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_run_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_run_signals_research_run_id_signal_id_key" ON "planner"."research_run_signals"("research_run_id", "signal_id");
CREATE INDEX "research_run_signals_signal_id_idx" ON "planner"."research_run_signals"("signal_id");

CREATE TABLE "planner"."project_signal_assessments" (
    "id" SERIAL NOT NULL,
    "signal_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "profile_revision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "fit_score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "matched_dimensions" JSONB,
    "risks" JSONB,
    "state" TEXT NOT NULL DEFAULT 'suggested',
    "assessment_adapter" TEXT NOT NULL,
    "assessment_version" TEXT NOT NULL,
    "assessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_signal_assessments_fit_score_check" CHECK ("fit_score" BETWEEN 0 AND 100),
    CONSTRAINT "project_signal_assessments_state_check" CHECK ("state" IN ('unrouted', 'suggested', 'routed', 'dismissed')),
    CONSTRAINT "project_signal_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_signal_assessments_signal_id_project_id_profile_revision_key" ON "planner"."project_signal_assessments"("signal_id", "project_id", "profile_revision");
CREATE INDEX "project_signal_assessments_project_id_state_fit_score_idx" ON "planner"."project_signal_assessments"("project_id", "state", "fit_score");
CREATE INDEX "project_signal_assessments_signal_id_project_id_idx" ON "planner"."project_signal_assessments"("signal_id", "project_id");

CREATE TABLE "planner"."project_signal_routes" (
    "id" SERIAL NOT NULL,
    "signal_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "assessment_revision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'routed',
    "actor_id" TEXT NOT NULL,
    "note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "promoted_artifact_type" TEXT,
    "promoted_artifact_id" INTEGER,
    "promoted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_signal_routes_state_check" CHECK ("state" IN ('routed', 'dismissed', 'promoted')),
    CONSTRAINT "project_signal_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_signal_routes_project_id_actor_id_idempotency_key_key" ON "planner"."project_signal_routes"("project_id", "actor_id", "idempotency_key");
CREATE UNIQUE INDEX "project_signal_routes_signal_id_project_id_key" ON "planner"."project_signal_routes"("signal_id", "project_id");
CREATE INDEX "project_signal_routes_project_id_state_created_at_idx" ON "planner"."project_signal_routes"("project_id", "state", "created_at");
CREATE INDEX "project_signal_routes_assessment_id_idx" ON "planner"."project_signal_routes"("assessment_id");

ALTER TABLE "planner"."organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "planner"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."research_connections" ADD CONSTRAINT "research_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_research_profiles" ADD CONSTRAINT "project_research_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_research_profiles" ADD CONSTRAINT "project_research_profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "planner"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planner"."research_runs" ADD CONSTRAINT "research_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."research_runs" ADD CONSTRAINT "research_runs_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "planner"."research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planner"."source_signals" ADD CONSTRAINT "source_signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "planner"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."research_run_signals" ADD CONSTRAINT "research_run_signals_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "planner"."research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."research_run_signals" ADD CONSTRAINT "research_run_signals_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "planner"."source_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_signal_assessments" ADD CONSTRAINT "project_signal_assessments_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "planner"."source_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_signal_assessments" ADD CONSTRAINT "project_signal_assessments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_signal_routes" ADD CONSTRAINT "project_signal_routes_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "planner"."source_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_signal_routes" ADD CONSTRAINT "project_signal_routes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."project_signal_routes" ADD CONSTRAINT "project_signal_routes_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "planner"."project_signal_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
