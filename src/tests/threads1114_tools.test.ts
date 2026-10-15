import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
test('1114 exact controls are owner/publisher only, not authoring roles', () => {
    for (const name of ['ba_release_threads_task1114_api', 'ba_publish_threads_task1114']) {
        assert.equal(isToolAllowedForProfile('owner', name), true);
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        assert.equal(isToolAllowedForProfile('writer', name), false);
        assert.equal(isToolAllowedForProfile('planner', name), false);
    }
});
