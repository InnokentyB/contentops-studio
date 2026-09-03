ALTER TABLE "planner"."mcp_access_tokens"
DROP CONSTRAINT IF EXISTS "mcp_access_tokens_profile_check";

ALTER TABLE "planner"."mcp_access_tokens"
ADD CONSTRAINT "mcp_access_tokens_profile_check"
CHECK ("profile" IN ('strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst'));
