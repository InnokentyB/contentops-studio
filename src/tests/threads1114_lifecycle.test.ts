import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

const Contract = z.object({ assertThreads1114Snapshot: z.custom<(input: unknown, released: boolean) => void>(v => typeof v === 'function') });
function contract() {
    let raw: unknown = null;
    try { raw = require('../services/threads1114_contract'); }
    catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    const parsed = Contract.safeParse(raw);
    assert.ok(parsed.success, 'exact1114 canonical package guard is absent');
    return parsed.data;
}
const base = {
    projectId: 10, taskId: 1114, channelId: 138, revision: 1, acceptedRevision: 1,
    bodySha256: '466b5444832d0b0fdf326461cbe7e6c3a41aab5704b9bc42697f29676f938f5a',
    scheduleAt: '2026-10-14T16:30:00.000Z', publishAt: '2026-10-14T16:30:00.000Z',
    manifest: 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',
    owner: true, activeChannel: true, username: 'innokentybo', userId: '39421253764155091',
    accepted: true, handoffReady: true, selectedAssetId: null, visualState: 'NO_VISUAL_NEEDED',
    decisionId: 309, decisionVersion: 1, decisionRevision: 1, decisionActive: true,
    decisionKind: 'NO_VISUAL_NEEDED', decisionChannel: 'threads', placement: 'feed',
    reviewComplete: true, artComplete: true, hasFact: false, hasAttempt: false, hasBrowserWork: false,
    status: 'ready_for_execution', mode: 'approval_required'
};
test('1114 canonical guard accepts only exact released/accepted packages and immutable bindings', () => {
    const c = contract(); c.assertThreads1114Snapshot(base, false);
    c.assertThreads1114Snapshot({ ...base, mode: 'owner_released' }, true);
    for (const patch of [{ owner: false }, { channelId: 164 }, { revision: 2 }, { acceptedRevision: 2 },
        { bodySha256: 'b'.repeat(64) }, { publishAt: '2026-10-15T16:30:00.000Z' },
        { userId: 'other' }, { manifest: `sha256:${'b'.repeat(64)}` }, { decisionId: 308 },
        { decisionActive: false }, { reviewComplete: false }, { hasFact: true }, { hasAttempt: true },
        { hasBrowserWork: true }, { mode: 'connector_auto' }, { selectedAssetId: 1 }]) {
        assert.throws(() => c.assertThreads1114Snapshot({ ...base, ...patch }, false));
    }
});
