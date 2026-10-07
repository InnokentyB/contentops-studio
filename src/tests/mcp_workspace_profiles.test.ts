import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('publisher sees only exact 1033/1035 releases while editorial roles cannot release', () => {
    for (const tool of ['ba_release_x_task1033_browser', 'ba_release_approved_threads_task1035']) {
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
            assert.equal(isToolAllowedForProfile(profile, tool), false);
        }
    }
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_pending_threads_task'), false);
});

test('publisher can access exact task1076 owner release without opening generic LinkedIn administration', () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_linkedin_task1076_browser'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_linkedin_browser_task'), false);
    for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_release_linkedin_task1076_browser'), false);
    }
});

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
