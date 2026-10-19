CREATE TABLE "planner"."provider_oauth_connection_attempts" (
 "id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "purpose" TEXT NOT NULL,
 "state_hash" TEXT NOT NULL UNIQUE, "browser_hash" TEXT NOT NULL, "client_id" TEXT NOT NULL,
 "user_id" INTEGER NOT NULL, "project_id" INTEGER NOT NULL, "channel_id" INTEGER NOT NULL,
 "account_kind" TEXT NOT NULL, "expected_author_urn" TEXT, "expected_profile_slug" TEXT, "channel_config_hash" TEXT NOT NULL,
 "redirect_uri" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMPTZ(6) NOT NULL, "consumed_at" TIMESTAMPTZ(6),
 "completed_at" TIMESTAMPTZ(6), "failure_code" TEXT
);
CREATE INDEX "provider_oauth_channel_created_idx"
 ON "planner"."provider_oauth_connection_attempts"("project_id","channel_id","created_at");
