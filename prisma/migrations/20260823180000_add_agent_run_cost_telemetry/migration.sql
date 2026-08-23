ALTER TABLE "planner"."agent_runs"
    ADD COLUMN "provider" TEXT,
    ADD COLUMN "model" TEXT,
    ADD COLUMN "input_tokens" INTEGER,
    ADD COLUMN "output_tokens" INTEGER,
    ADD COLUMN "cached_input_tokens" INTEGER,
    ADD COLUMN "reasoning_tokens" INTEGER,
    ADD COLUMN "image_tokens" INTEGER,
    ADD COLUMN "estimated_cost_usd" DECIMAL(12,8),
    ADD COLUMN "latency_ms" INTEGER,
    ADD COLUMN "provider_request_id" TEXT,
    ADD COLUMN "invocation_metadata" JSONB;

CREATE INDEX "agent_runs_model_idx" ON "planner"."agent_runs"("model");
CREATE INDEX "agent_runs_created_at_idx" ON "planner"."agent_runs"("created_at");

ALTER TABLE "planner"."image_assets" ALTER COLUMN "provider" SET DEFAULT 'google';
