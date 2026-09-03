import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('new project-scoped roles cannot reach owner administration or direct publication', () => {
    for (const profile of ['editor', 'publisher', 'growth_analyst'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_list_users'), false);
        assert.equal(isToolAllowedForProfile(profile, 'ba_publish_direct'), false);
        assert.equal(isToolAllowedForProfile(profile, 'ba_recover_content_review'), false);
    }
});

test('database constraint permits all seven managed workspace profiles', () => {
    const migration = readFileSync(join(
        process.cwd(),
        'prisma/migrations/20260903120000_add_agent_workspace_profiles/migration.sql'
    ), 'utf8');
    for (const profile of ['strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst']) {
        assert.match(migration, new RegExp(`'${profile}'`));
    }
});
