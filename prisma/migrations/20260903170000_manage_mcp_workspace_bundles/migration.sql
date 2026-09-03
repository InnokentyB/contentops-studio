ALTER TABLE "planner"."mcp_access_tokens"
ADD COLUMN "bundle_id" TEXT;

CREATE INDEX "mcp_access_tokens_project_id_user_id_bundle_id_idx"
ON "planner"."mcp_access_tokens"("project_id", "user_id", "bundle_id");
