-- Additive only. No old attempts are admitted or made retryable.
CREATE TABLE "planner"."browser_delivery_recovery" (
 "id" SERIAL PRIMARY KEY,
 "project_id" INTEGER NOT NULL,
 "content_item_id" INTEGER NOT NULL,
 "attempt_id" INTEGER NOT NULL,
 "work_item_id" INTEGER NOT NULL,
 "contract_version" INTEGER NOT NULL DEFAULT 2,
 "row_version" INTEGER NOT NULL DEFAULT 0,
 "execution_generation" INTEGER NOT NULL DEFAULT 0,
 "package_sha256" TEXT NOT NULL,
 "approval_sha256" TEXT NOT NULL,
 "original_snapshot" JSONB NOT NULL,
 "lookup_window_start_at" TIMESTAMPTZ(6),
 "lookup_window_end_at" TIMESTAMPTZ(6),
 "stage" TEXT NOT NULL,
 "delivery_certainty" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'idle',
 "cause_code" TEXT NOT NULL,
 "recovery_action" TEXT NOT NULL,
 "rounds" INTEGER NOT NULL DEFAULT 0,
 "requests_used" INTEGER NOT NULL DEFAULT 0,
 "started_at" TIMESTAMPTZ(6),
 "deadline_at" TIMESTAMPTZ(6),
 "next_read_at" TIMESTAMPTZ(6),
 "recovery_lease_sha256" TEXT,
 "recovery_lease_expires_at" TIMESTAMPTZ(6),
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "browser_delivery_recovery_project_id_attempt_id_fkey"
 FOREIGN KEY ("project_id", "attempt_id") REFERENCES "planner"."delivery_attempts"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "browser_recovery_budget_bounds" CHECK ("rounds" BETWEEN 0 AND 3 AND "requests_used" BETWEEN 0 AND 20),
 CONSTRAINT "browser_recovery_version_bounds" CHECK ("contract_version" = 2 AND "row_version" >= 0 AND "execution_generation" >= 0)
);
CREATE UNIQUE INDEX "browser_delivery_recovery_project_id_attempt_id_key" ON "planner"."browser_delivery_recovery"("project_id", "attempt_id");
CREATE INDEX "browser_delivery_recovery_project_id_content_item_id_idx" ON "planner"."browser_delivery_recovery"("project_id", "content_item_id");
