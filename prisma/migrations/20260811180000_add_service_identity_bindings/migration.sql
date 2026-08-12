CREATE TABLE "planner"."service_identity_bindings" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_identity_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_identity_bindings_project_id_actor_id_key"
ON "planner"."service_identity_bindings"("project_id", "actor_id");

CREATE INDEX "service_identity_bindings_actor_id_is_active_idx"
ON "planner"."service_identity_bindings"("actor_id", "is_active");

ALTER TABLE "planner"."service_identity_bindings"
ADD CONSTRAINT "service_identity_bindings_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "planner"."projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
