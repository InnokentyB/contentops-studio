ALTER TABLE "planner"."users"
ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "planner"."users"."is_demo"
IS 'Read-only product demonstration account; all state-changing API requests are denied';
