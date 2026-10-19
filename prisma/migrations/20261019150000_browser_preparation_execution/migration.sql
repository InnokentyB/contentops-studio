-- Additive technical state only; no historical attempts or workers are admitted.
CREATE TABLE "planner"."browser_preparation_execution" (
  "project_id" INTEGER NOT NULL,
  "attempt_id" INTEGER NOT NULL,
  "content_item_id" INTEGER NOT NULL,
  "work_item_id" INTEGER NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 0,
  "ledger" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "browser_preparation_execution_pkey" PRIMARY KEY ("project_id", "attempt_id"),
  CONSTRAINT "browser_preparation_execution_project_id_attempt_id_fkey" FOREIGN KEY ("project_id", "attempt_id") REFERENCES "planner"."delivery_attempts"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "browser_preparation_execution_row_version_check" CHECK ("row_version" >= 0)
);
CREATE INDEX "browser_preparation_execution_project_id_content_item_id_idx" ON "planner"."browser_preparation_execution"("project_id", "content_item_id");
