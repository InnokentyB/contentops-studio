import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
test('1128 expired lease renewal is isolated to the exact owner/Publisher task route', () => {
    const name = 'ba_renew_linkedin_task1128_browser_lease';
    assert.equal(isToolAllowedForProfile('owner', name), true);
    assert.equal(isToolAllowedForProfile('publisher', name), true);
    assert.equal(isToolAllowedForProfile('planner', name), false);
    assert.equal(isToolAllowedForProfile('writer', name), false);
});
