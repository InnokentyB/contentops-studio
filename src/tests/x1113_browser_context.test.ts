import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { checkX1113LiveContext, executeX1113NativeSubmit } from '../services/x1113_browser_context';
import { requireX1113RuntimeProof } from '../services/x1113_guard';
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
    browsers: [{ id: 'ephemeral-2', profileName: 'Innokenty' }], targetTab: { browserId: 'ephemeral-2', tabId: 'native-tab', url: 'https://x.com/home' },
    accountRef: '@naraHeTc', source: 'native_cua_browser_info' };
const acceptedText = 'A beta is a test harness: define entry criteria and the evidence expected back.\n\nFor Podmasterie’s planned beta, free access will follow an application and a commitment to two short structured reports.\n\nInterviews and testimonials stay optional. What would you require?';
const editor = { ...context, editorText: acceptedText, mediaCount: 0, submitEnabled: true, compositionKind: 'new_post' };
test('1113 server checks stage-bound native guard output, never an arbitrary tag/hash', () => {
    const start = checkX1113LiveContext(context, 'start', now);
    const submit = checkX1113LiveContext(editor, 'submit', now);
    requireX1113RuntimeProof(start, 'start', now); requireX1113RuntimeProof(submit, 'submit', now);
    assert.throws(() => requireX1113RuntimeProof(start, 'submit', now), /LIVE_PERSONAL_CONTEXT_REQUIRED/);
    assert.throws(() => requireX1113RuntimeProof({ ...submit, clientRuntimeGuardSha256: 'a'.repeat(64) }, 'submit', now), /LIVE_PERSONAL_CONTEXT_REQUIRED/);
});
test('1113 uses live personal profile and never persists its ephemeral browser ID', () => {
    const result = feature().checkX1113LiveContext(context, 'start', now);
    assert.ok(!JSON.stringify(result).includes('ephemeral-2'));
});
test('1113 blocks working/stale/foreign-tab/foreign-account context before attempt or Submit', () => {
    for (const patch of [{ browsers: [{ id: 'ephemeral-2', profileName: 'innokentybodrov.com' }] },
        { observedAt: '2026-10-15T09:58:00Z' }, { targetTab: { browserId: 'working', tabId: 'native-tab', url: 'https://x.com/home' } },
        { accountRef: '@other' }, { source: 'stored_profile_tag' }]) {
        assert.throws(() => feature().checkX1113LiveContext({ ...context, ...patch }, 'start', now));
    }
});
test('1113 Submit requires exact native editor readback, no media and enabled Post button', () => {
    assert.throws(() => feature().checkX1113LiveContext(context, 'submit', now));
    assert.throws(() => feature().checkX1113LiveContext({ ...context, editorText: 'changed copy', mediaCount: 0, submitEnabled: true }, 'submit', now));
});
test('1113 runtime never requests server permission or clicks from a working browser', async () => {
    let effects = 0;
    await assert.rejects(executeX1113NativeSubmit({
        readNativeContext: async () => ({ ...context, browsers: [{ id: 'ephemeral-2', profileName: 'innokentybodrov.com' }] }),
        preSubmit: async () => { effects += 1; return { submission_permitted: true }; },
        clickNativePost: async () => { effects += 1; }, now: () => now
    }), /PERSONAL_BROWSER_REQUIRED/);
    assert.equal(effects, 0);
});
test('1113 native runtime checks twice, binds target and never retries an ambiguous click', async () => {
    let reads = 0; let permissions = 0; let clicks = 0;
    await assert.rejects(executeX1113NativeSubmit({ readNativeContext: async () => { reads += 1; return editor; },
        preSubmit: async () => { permissions += 1; return { submission_permitted: true }; },
        clickNativePost: async target => { clicks += 1; assert.equal(target.tabId, 'native-tab'); throw new Error('synthetic uncertain'); },
        now: () => now }), /synthetic uncertain/);
    assert.equal(reads, 2); assert.equal(permissions, 1); assert.equal(clicks, 1);
});
test('1113 native surface drift or replayed server permission forbids Post', async () => {
    for (const permitted of [false, true]) {
        let reads = 0; let clicks = 0;
        await assert.rejects(executeX1113NativeSubmit({
            readNativeContext: async () => ++reads === 1 ? editor : { ...editor,
                targetTab: { ...editor.targetTab, tabId: 'different-tab' } },
            preSubmit: async () => ({ submission_permitted: permitted }),
            clickNativePost: async () => { clicks += 1; }, now: () => now
        }), permitted ? /SURFACE_CHANGED/ : /SUBMIT_NOT_PERMITTED/);
        assert.equal(clicks, 0);
    }
});
