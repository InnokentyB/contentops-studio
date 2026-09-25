-- Manual provider-confirmed publications can predate a Planner channel binding.
-- The fact retains a null channel instead of inventing or misattributing one.
ALTER TABLE planner.publication_facts
  ALTER COLUMN channel_id DROP NOT NULL;
