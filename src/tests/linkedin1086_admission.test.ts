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

test('same41 approval/recovery tools remain Publisher-only and never expose writer/planner authority', () => {
    for (const name of ['ba_recover_linkedin_task1086_attempt41', 'ba_record_linkedin_task1086_recovery_approval']) {
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        for (const role of ['writer', 'planner', 'editor', 'art_director', 'strategist', 'growth_analyst'] as const) {
            assert.equal(isToolAllowedForProfile(role, name), false, `${role}:${name}`);
        }
    }
});
