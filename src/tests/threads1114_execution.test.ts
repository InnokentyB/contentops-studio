import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { THREADS1114 as p } from '../services/threads1114_contract';
type Args = { projectId: number; taskId: number; actorId: string; expectedManifestChecksum: string;
    approvalReference: string; idempotencyKey: string; dryRun?: boolean };
type Ports = { replay(args: Args, operation: 'release' | 'send'): Promise<Record<string, unknown> | null>;
    inspect(args: Args, released: boolean): Promise<{ snapshot: unknown; credentialReady: boolean; releaseValid: boolean }>;
    preflight(): Promise<void>; release(args: Args): Promise<Record<string, unknown>>;
    claim(args: Args): Promise<{ id: number; body: string }>; assertDispatch(args: Args, id: number): Promise<void>;
    publish(body: string): Promise<{ id: string; url: string; publishedAt: string }>;
    confirm(args: Args, id: number, result: { id: string; url: string; publishedAt: string }): Promise<Record<string, unknown>>;
    uncertain(args: Args, id: number): Promise<void>; now(): number };
const Contract = z.object({ releaseThreads1114: z.custom<(ports: Ports, args: Args) => Promise<unknown>>(v => typeof v === 'function'),
    executeThreads1114: z.custom<(ports: Ports, args: Args) => Promise<Record<string, unknown>>>(v => typeof v === 'function') });
function feature() {
    let raw: unknown;
    try { raw = require('../services/threads1114_execution'); }
    catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error; }
    const parsed = Contract.safeParse(raw); assert.ok(parsed.success, 'exact1114 release/send lifecycle absent'); return parsed.data;
}
const args: Args = { projectId: 10, taskId: 1114, actorId: 'user:2', expectedManifestChecksum: p.manifest,
    approvalReference: 'owner evening1114 exact GO', idempotencyKey: '1114-send-v1' };
function fixture() {
    let released = false; let prior: Record<string, unknown> | null = null; const calls: string[] = [];
    const snapshot = { ...p, acceptedRevision: 1, revision: 1, bodySha256: p.bodySha256,
        scheduleAt: p.schedule, publishAt: p.schedule, owner: true, activeChannel: true,
        accepted: true, handoffReady: true, selectedAssetId: null, visualState: 'NO_VISUAL_NEEDED',
        decisionVersion: 1, decisionRevision: 1, decisionActive: true, decisionKind: 'NO_VISUAL_NEEDED',
        decisionChannel: 'threads', placement: 'feed', reviewComplete: true, artComplete: true,
        hasFact: false, hasAttempt: false, hasBrowserWork: false, status: 'ready_for_execution' };
    const ports: Ports = { replay: async () => prior, inspect: async () => ({ snapshot: { ...snapshot,
        mode: released ? 'owner_released' : 'approval_required' }, credentialReady: true, releaseValid: released }),
        preflight: async () => { calls.push('preflight'); },
        release: async () => { released = true; return { publication_authorized: true }; },
        claim: async () => { calls.push('claim'); prior = { mode: 'verification_required', retry_allowed: false }; return { id: 1, body: 'fixture body' }; },
        assertDispatch: async () => { calls.push('dispatch-check'); },
        publish: async () => { calls.push('publish'); return { id: '123456', url: 'https://www.threads.com/@innokentybo/post/abc', publishedAt: '2026-10-14T16:31:00Z' }; },
        confirm: async (_a, _id, result) => { calls.push('confirm'); prior = { mode: 'published', provider_object_id: result.id }; return prior; },
        uncertain: async () => { calls.push('uncertain'); }, now: () => Date.parse('2026-10-14T16:31:00Z') };
    return { ports, calls, snapshot };
}
test('1114 release then one claimed send uses actual API object ID and confirmed replay never sends again', async () => {
    const f = fixture(); const api = feature(); await api.releaseThreads1114(f.ports, args);
    assert.equal((await api.executeThreads1114(f.ports, args)).provider_object_id, '123456');
    await api.executeThreads1114(f.ports, args);
    assert.deepEqual(f.calls, ['preflight', 'preflight', 'claim', 'dispatch-check', 'publish', 'confirm']);
});
test('1114 unreleased, changed package or foreign scope cannot call provider or claim', async () => {
    const f = fixture(); await assert.rejects(feature().executeThreads1114(f.ports, args)); assert.deepEqual(f.calls, []);
    f.snapshot.hasFact = true; await assert.rejects(feature().releaseThreads1114(f.ports, args)); assert.deepEqual(f.calls, []);
    await assert.rejects(feature().releaseThreads1114(f.ports, { ...args, taskId: 1110 }));
});
test('1114 uncertain result is sanitized/frozen and identical replay does not retry', async () => {
    const f = fixture(); const api = feature(); await api.releaseThreads1114(f.ports, args);
    f.ports.publish = async () => { f.calls.push('publish'); throw new Error('TOKEN_SECRET'); };
    await assert.rejects(api.executeThreads1114(f.ports, args), (e: unknown) => e instanceof Error && /UNCERTAIN/.test(e.message) && !e.message.includes('TOKEN_SECRET'));
    assert.equal((await api.executeThreads1114(f.ports, args)).retry_allowed, false);
    assert.equal(f.calls.filter(v => v === 'publish').length, 1); assert.ok(!f.calls.includes('confirm'));
});
