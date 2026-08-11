-- Create ImageAsset table
CREATE TABLE IF NOT EXISTS "planner"."image_assets" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "content_item_id" INTEGER NOT NULL,
  "asset_version" INTEGER NOT NULL DEFAULT 1,
  "prompt" TEXT NOT NULL,
  "prompt_version" INTEGER NOT NULL DEFAULT 1,
  "provider" TEXT NOT NULL DEFAULT 'gemini-imagen-3',
  "model" TEXT,
  "seed" INTEGER,
  "alt_text" TEXT,
  "aspect_ratio" TEXT,
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "image_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "image_assets_project_id_idx" ON "planner"."image_assets"("project_id");
CREATE INDEX IF NOT EXISTS "image_assets_content_item_id_idx" ON "planner"."image_assets"("content_item_id");
