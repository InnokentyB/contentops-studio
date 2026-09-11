-- Compatibility bridge for clean installs created by the legacy public-schema migrations.
-- Existing production databases already have these tables in planner, so every branch is a no-op.
CREATE SCHEMA IF NOT EXISTS "planner";

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'users', 'projects', 'project_members', 'project_settings', 'social_channels',
        'weeks', 'posts', 'events', 'prompt_presets', 'comments', 'provider_keys',
        'telegram_accounts', 'agent_runs'
    ]
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL
           AND to_regclass(format('planner.%I', table_name)) IS NULL THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA planner', table_name);
        END IF;
    END LOOP;
END $$;
