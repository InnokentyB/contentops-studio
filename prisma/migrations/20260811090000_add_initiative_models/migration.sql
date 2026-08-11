-- AlterTable work_items
ALTER TABLE "planner"."work_items" ADD COLUMN IF NOT EXISTS "initiative_id" INTEGER;

-- CreateTable initiatives
CREATE TABLE IF NOT EXISTS "planner"."initiatives" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "campaign_id" INTEGER,
    "week_package_id" INTEGER,
    "external_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "owner_role" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "start_at" TIMESTAMPTZ(6),
    "end_at" TIMESTAMPTZ(6),
    "decision_at" TIMESTAMPTZ(6),
    "event_at" TIMESTAMPTZ(6),
    "measurement_at" TIMESTAMPTZ(6),
    "dependencies_status" TEXT NOT NULL DEFAULT 'dependencies_unknown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable initiative_dependencies
CREATE TABLE IF NOT EXISTS "planner"."initiative_dependencies" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "from_initiative_id" INTEGER NOT NULL,
    "to_initiative_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'blocks',
    "condition" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "initiative_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "initiatives_project_id_external_key_key" ON "planner"."initiatives"("project_id", "external_key");
CREATE INDEX IF NOT EXISTS "initiatives_project_id_idx" ON "planner"."initiatives"("project_id");
CREATE INDEX IF NOT EXISTS "initiatives_kind_idx" ON "planner"."initiatives"("kind");
CREATE INDEX IF NOT EXISTS "initiatives_status_idx" ON "planner"."initiatives"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "initiative_dependencies_from_initiative_id_to_initiative_id_type_key" ON "planner"."initiative_dependencies"("from_initiative_id", "to_initiative_id", "type");
CREATE INDEX IF NOT EXISTS "initiative_dependencies_project_id_idx" ON "planner"."initiative_dependencies"("project_id");
CREATE INDEX IF NOT EXISTS "initiative_dependencies_from_initiative_id_idx" ON "planner"."initiative_dependencies"("from_initiative_id");
CREATE INDEX IF NOT EXISTS "initiative_dependencies_to_initiative_id_idx" ON "planner"."initiative_dependencies"("to_initiative_id");

CREATE INDEX IF NOT EXISTS "work_items_initiative_id_idx" ON "planner"."work_items"("initiative_id");

-- Foreign Keys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiatives_project_id_fkey') THEN
        ALTER TABLE "planner"."initiatives" ADD CONSTRAINT "initiatives_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiatives_week_package_id_fkey') THEN
        ALTER TABLE "planner"."initiatives" ADD CONSTRAINT "initiatives_week_package_id_fkey" FOREIGN KEY ("week_package_id") REFERENCES "planner"."week_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiative_dependencies_project_id_fkey') THEN
        ALTER TABLE "planner"."initiative_dependencies" ADD CONSTRAINT "initiative_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiative_dependencies_from_initiative_id_fkey') THEN
        ALTER TABLE "planner"."initiative_dependencies" ADD CONSTRAINT "initiative_dependencies_from_initiative_id_fkey" FOREIGN KEY ("from_initiative_id") REFERENCES "planner"."initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiative_dependencies_to_initiative_id_fkey') THEN
        ALTER TABLE "planner"."initiative_dependencies" ADD CONSTRAINT "initiative_dependencies_to_initiative_id_fkey" FOREIGN KEY ("to_initiative_id") REFERENCES "planner"."initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_initiative_id_fkey') THEN
        ALTER TABLE "planner"."work_items" ADD CONSTRAINT "work_items_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "planner"."initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
