CREATE TABLE "planner"."mcp_access_tokens" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_access_tokens_profile_check" CHECK ("profile" IN ('planner', 'writer', 'art_director')),
    CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_access_tokens_token_hash_key" ON "planner"."mcp_access_tokens"("token_hash");
CREATE INDEX "mcp_access_tokens_project_id_profile_idx" ON "planner"."mcp_access_tokens"("project_id", "profile");
CREATE INDEX "mcp_access_tokens_user_id_revoked_at_idx" ON "planner"."mcp_access_tokens"("user_id", "revoked_at");

ALTER TABLE "planner"."mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "planner"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
