import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { exactOwnedRouteBlock } from '../services/exact_owned_route_guard';

test('1086 owning Publisher has its own lifecycle; writer cannot invoke it', () => {
    for (const command of ['repair', 'release', 'claim', 'start', 'pre_submit', 'confirm', 'reconcile', 'mark']) {
        const suffix = command === 'repair' ? 'metadata' : command === 'release' || command === 'claim'
            ? 'browser' : 'browser_submission';
        const name = `ba_${command}_linkedin_task1086_${suffix}${command === 'mark' ? '_uncertain' : ''}`;
        assert.equal(isToolAllowedForProfile('publisher', name), true, name);
        assert.equal(isToolAllowedForProfile('writer', name), false, name);
    }
});

test('generic dispatch must not bypass exact1086 release/attempt controls', () => {
    assert.equal(exactOwnedRouteBlock({project_id:7,id:1086,status:'browser_required'})?.required_command,
        'ba_start_linkedin_task1086_browser_submission');
    assert.equal(exactOwnedRouteBlock({project_id:10,id:1086}), null);
});
