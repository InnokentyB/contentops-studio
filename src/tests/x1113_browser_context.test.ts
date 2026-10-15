import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
const Feature = z.object({ checkX1113LiveContext: z.custom<(value: unknown, stage: 'start' | 'submit', now: number) => unknown>(v => typeof v === 'function') });
function feature() {
    let value: unknown;
    try { value = require('../services/x1113_browser_context'); } catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    return Feature.parse(value);
}
const now = Date.parse('2026-10-15T10:00:00Z');
const context = { observedAt: '2026-10-15T10:00:00Z', selectedBrowserId: 'ephemeral-2',
    browsers: [{ id: 'ephemeral-2', profileName: 'Innokenty' }], targetTab: { browserId: 'ephemeral-2', url: 'https://x.com/home' },
    accountRef: '@naraHeTc', source: 'native_cua_browser_info' };
test('1113 uses live personal profile and never persists its ephemeral browser ID', () => {
    const result = feature().checkX1113LiveContext(context, 'start', now);
    assert.ok(!JSON.stringify(result).includes('ephemeral-2'));
});
test('1113 blocks working/stale/foreign-tab/foreign-account context before attempt or Submit', () => {
    for (const patch of [{ browsers: [{ id: 'ephemeral-2', profileName: 'innokentybodrov.com' }] },
        { observedAt: '2026-10-15T09:58:00Z' }, { targetTab: { browserId: 'working' } },
        { accountRef: '@other' }, { source: 'stored_profile_tag' }]) {
        assert.throws(() => feature().checkX1113LiveContext({ ...context, ...patch }, 'start', now));
    }
});
test('1113 Submit requires exact native editor readback, no media and enabled Post button', () => {
    assert.throws(() => feature().checkX1113LiveContext(context, 'submit', now));
    assert.throws(() => feature().checkX1113LiveContext({ ...context, editorText: 'changed copy', mediaCount: 0, submitEnabled: true }, 'submit', now));
});
