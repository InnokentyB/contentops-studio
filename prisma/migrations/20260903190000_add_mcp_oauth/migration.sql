CREATE TABLE "planner"."mcp_oauth_clients" (
    "id" SERIAL NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uris" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "planner"."mcp_oauth_authorization_codes" (
    "id" SERIAL NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "planner"."mcp_oauth_tokens" (
    "id" SERIAL NOT NULL,
    "family_id" TEXT NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "planner"."mcp_oauth_clients"("client_id");
CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_code_hash_key" ON "planner"."mcp_oauth_authorization_codes"("code_hash");
CREATE INDEX "mcp_oauth_authorization_codes_client_id_expires_at_idx" ON "planner"."mcp_oauth_authorization_codes"("client_id", "expires_at");
CREATE INDEX "mcp_oauth_authorization_codes_project_id_user_id_idx" ON "planner"."mcp_oauth_authorization_codes"("project_id", "user_id");
CREATE UNIQUE INDEX "mcp_oauth_tokens_access_token_hash_key" ON "planner"."mcp_oauth_tokens"("access_token_hash");
CREATE UNIQUE INDEX "mcp_oauth_tokens_refresh_token_hash_key" ON "planner"."mcp_oauth_tokens"("refresh_token_hash");
CREATE INDEX "mcp_oauth_tokens_client_id_revoked_at_idx" ON "planner"."mcp_oauth_tokens"("client_id", "revoked_at");
CREATE INDEX "mcp_oauth_tokens_family_id_revoked_at_idx" ON "planner"."mcp_oauth_tokens"("family_id", "revoked_at");
CREATE INDEX "mcp_oauth_tokens_project_id_user_id_revoked_at_idx" ON "planner"."mcp_oauth_tokens"("project_id", "user_id", "revoked_at");

ALTER TABLE "planner"."mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "planner"."mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "planner"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "planner"."mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner"."mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "planner"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
