import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { isManagedMcpProfile } from '../services/mcp_access_token.service';

test('strategist is a managed profile that can be issued as an access token', () => {
    assert.equal(isManagedMcpProfile('strategist'), true);
});

test('database constraint permits strategist access tokens', () => {
    const migration = readFileSync(join(
        process.cwd(),
        'prisma/migrations/20260902173000_allow_strategist_mcp_profile/migration.sql'
    ), 'utf8');

    assert.match(migration, /DROP CONSTRAINT IF EXISTS "mcp_access_tokens_profile_check"/);
    assert.match(migration, /'planner', 'writer', 'art_director', 'strategist'/);
});

test('strategist cannot publish and cannot spend the deployment owner provider key', () => {
    // ba_publish_publication_task reaches a live channel.
    assert.equal(isToolAllowedForProfile('strategist', 'ba_publish_publication_task'), false);
    // ba_generate_week_topic_preview falls back to process.env.OPENAI_API_KEY
    // when the project has no ProviderKey of its own.
    assert.equal(isToolAllowedForProfile('strategist', 'ba_generate_week_topic_preview'), false);
    // Direct publication and cross-tenant administration were never in the planner set.
    assert.equal(isToolAllowedForProfile('strategist', 'ba_publish_direct'), false);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_list_users'), false);
});

test('strategist keeps the read and planning surface it needs', () => {
    for (const tool of [
        'ba_get_agent_workspace_manifest',
        'ba_get_agent_chat_bootstrap',
        'ba_list_project_channels',
        'ba_list_publication_tasks',
        'ba_list_initiatives',
        'ba_upsert_initiative',
        'ba_link_initiatives',
        'ba_upsert_week_theme',
        'ba_start_week_autogeneration',
        'ba_reschedule_work_item',
        'ba_audit_plan_coverage',
        'ba_get_operational_calendar'
    ]) {
        assert.equal(isToolAllowedForProfile('strategist', tool), true, `${tool} should stay available`);
    }
});

test('adding strategist does not widen the existing profiles', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_publish_publication_task'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_generate_week_topic_preview'), true);
    assert.equal(isToolAllowedForProfile('writer', 'ba_upsert_initiative'), false);
    assert.equal(isToolAllowedForProfile('art_director', 'ba_upsert_week_theme'), false);
    assert.equal(isToolAllowedForProfile('owner', 'ba_publish_direct'), true);
});
