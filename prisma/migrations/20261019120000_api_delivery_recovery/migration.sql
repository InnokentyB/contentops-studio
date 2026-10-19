CREATE TABLE "planner"."api_delivery_recovery" (
 "id" SERIAL PRIMARY KEY, "project_id" INTEGER NOT NULL, "content_item_id" INTEGER NOT NULL,
 "attempt_id" INTEGER NOT NULL, "transport" TEXT NOT NULL DEFAULT 'threads_api',
 "contract_version" INTEGER NOT NULL DEFAULT 1, "row_version" INTEGER NOT NULL DEFAULT 0,
 "generation" INTEGER NOT NULL DEFAULT 1, "state" TEXT NOT NULL DEFAULT 'claimed',
 "package_sha256" TEXT NOT NULL, "release_sha256" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "container_id" TEXT, "post_id" TEXT, "publish_started_at" TIMESTAMPTZ(6), "observed_at" TIMESTAMPTZ(6),
 "rounds" INTEGER NOT NULL DEFAULT 0, "requests_used" INTEGER NOT NULL DEFAULT 0,
 "deadline_at" TIMESTAMPTZ(6), "next_read_at" TIMESTAMPTZ(6), "lease_sha256" TEXT,
 "lease_expires_at" TIMESTAMPTZ(6), "cause_code" TEXT,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "api_delivery_recovery_attempt_fkey" FOREIGN KEY ("project_id", "attempt_id")
 REFERENCES "planner"."delivery_attempts"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "api_delivery_recovery_budget_check" CHECK (rounds BETWEEN 0 AND 3 AND requests_used BETWEEN 0 AND 20)
);
CREATE UNIQUE INDEX "api_delivery_recovery_project_id_attempt_id_key" ON "planner"."api_delivery_recovery"("project_id", "attempt_id");
CREATE INDEX "api_delivery_recovery_project_id_content_item_id_idx" ON "planner"."api_delivery_recovery"("project_id", "content_item_id");
