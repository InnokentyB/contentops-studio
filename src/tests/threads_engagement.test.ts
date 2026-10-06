import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('Threads engagement tools separate research from live replies', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_threads_search_posts'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_threads_get_replies'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_threads_comment'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_threads_search_posts'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_threads_get_replies'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_threads_comment'), false);
    assert.equal(isToolAllowedForProfile('organization_researcher', 'ba_threads_comment'), false);
});
