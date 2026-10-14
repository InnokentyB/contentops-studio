import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

type Args = { projectId: number; taskId: number; actorId: string; expectedManifestChecksum: string;
    approvalReference: string; idempotencyKey: string; apply: boolean };
type Event = { before_state: Record<string, unknown>; after_state: Record<string, unknown> };
type Ports = { transaction<T>(cb: (tx: Tx) => Promise<T>): Promise<T>;
    getManifestChecksum(projectId: number, actorId: string): Promise<string>; hashBody(body: string): string };
type Tx = { owner(projectId: number, actorId: string): Promise<boolean>;
    task(): Promise<unknown>; prior(actorId: string, key: string): Promise<Event | null>;
    hasDelivery(): Promise<boolean>; hasBrowserWork(): Promise<boolean>;
    write(expected: unknown, binding: unknown): Promise<number>;
    audit(actorId: string, key: string, event: Event): Promise<void> };
const Module = z.object({ bindLinkedIn1128Identity: z.custom<(ports: Ports, args: Args) => Promise<Record<string, unknown>>>(v => typeof v === 'function') });
function implementation() {
    let raw: unknown;
    try { raw = require('../services/linkedin1128_identity.service'); }
    catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    const parsed = Module.safeParse(raw);
    assert.ok(parsed.success, 'audited exact1128 binding implementation absent');
    return parsed.data.bindLinkedIn1128Identity;
}
const manifest = 'sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd';
const args: Args = { projectId: 7, taskId: 1128, actorId: 'user:2', expectedManifestChecksum: manifest,
    approvalReference: 'human task-only binding approval 2026-10-14', idempotencyKey: 'identity1128-v1', apply: true };
const base = { id: 1128, project_id: 7, channel_id: 6, project_slug: 'seturon',
    content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'accepted body',
    schedule_at: '2026-10-14T10:00:00.000Z', publish_at: '2026-10-14T10:00:00.000Z',
    status: 'ready_for_execution', publication_mode: 'approval_required', handoff_state: 'ready',
    visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed', selected_asset_id: null,
    visual_decision_version: 1, decision_id: 305, decision_version: 1, decision_revision: 1,
    decision_status: 'active', decision: 'NO_VISUAL_NEEDED', decision_channel: 'linkedin',
    decision_placement: 'feed', channel_type: 'linkedin', channel_name: 'seturon_linkedin_page',
    account_ref: 'seturon_linkedin_page', account_type: 'company_page',
    channel_url: 'https://www.linkedin.com/company/seturon/', execution_modes: ['manual'],
    publication_fact: null, published_link: null, quality_report: {} };
function fixture(patch: Record<string, unknown> = {}) {
    let event: Event | null = null;
    let writes = 0;
    let audits = 0;
    let delivery = false;
    let work = false;
    let owner = true;
    let currentManifest = manifest;
    let snapshot: unknown = { ...base, ...patch };
    const tx: Tx = { owner: async () => owner, task: async () => snapshot,
        prior: async () => event, hasDelivery: async () => delivery, hasBrowserWork: async () => work,
        write: async (_expected, binding) => { writes++; snapshot = { ...base, quality_report: { identity_binding: binding } }; return 1; },
        audit: async (_actor, _key, next) => { audits++; event = next; } };
    const ports: Ports = { transaction: async cb => cb(tx), getManifestChecksum: async () => currentManifest,
        hashBody: () => '1bb16f09fc632f0ff18b062cd98b914acdbe849b3e8ea5ebd2483355a8a44452' };
    return { ports, tx, counts: () => ({ writes, audits }), delivery: () => { delivery = true; },
        work: () => { work = true; }, foreignOwner: () => { owner = false; }, stale: () => { currentManifest = `sha256:${'a'.repeat(64)}`; } };
}
test('1128 preview has no writes; apply records task-only unverified binding; replay has no second write', async () => {
    const bind = implementation(); const f = fixture();
    const preview = await bind(f.ports, { ...args, apply: false });
    assert.equal(preview.applied, false); assert.deepEqual(f.counts(), { writes: 0, audits: 0 });
    const applied = await bind(f.ports, args);
    assert.equal(applied.applied, true);
    const binding = z.object({ linkedin_company_id: z.literal('97416172'), provider_identity_verified: z.literal(false),
        verification_basis: z.literal('owner_adopted_registry_binding') }).parse(applied.identity_binding);
    assert.equal(binding.linkedin_company_id, '97416172');
    assert.equal((await bind(f.ports, args)).replayed, true);
    assert.deepEqual(f.counts(), { writes: 1, audits: 1 });
    await assert.rejects(bind(f.ports, { ...args, approvalReference: 'different approval' }), /IDEMPOTENCY_CONFLICT/);
});
test('1128 foreign/stale/changed/conflicting/delivery states fail closed without writes', async () => {
    const bind = implementation();
    for (const patch of [{ project_id: 10 }, { accepted_revision: 2 }, { channel_id: 5 },
        { publish_at: '2026-10-15T10:00:00.000Z' }, { decision_id: 306 }, { decision_status: 'superseded' },
        { publication_fact: {} }, { published_link: 'https://example.com' },
        { execution_modes: ['automated'] }, { quality_report: { publication_hold: { reason: 'held' } } },
        { quality_report: { identity_binding: { linkedin_company_id: 'foreign' } } }]) {
        const f = fixture(patch); await assert.rejects(bind(f.ports, args));
        assert.deepEqual(f.counts(), { writes: 0, audits: 0 });
    }
    for (const alter of ['delivery', 'work', 'foreignOwner', 'stale'] as const) {
        const f = fixture(); f[alter](); await assert.rejects(bind(f.ports, args));
        assert.deepEqual(f.counts(), { writes: 0, audits: 0 });
    }
    await assert.rejects(bind(fixture().ports, { ...args, projectId: 10 }));
});
test('1128 checks manifest again before CAS and never audits a failed CAS', async () => {
    const bind = implementation(); const stale = fixture(); let reads = 0;
    stale.ports.getManifestChecksum = async () => ++reads === 1 ? manifest : `sha256:${'a'.repeat(64)}`;
    await assert.rejects(bind(stale.ports, args), /STALE_MANIFEST/);
    assert.deepEqual(stale.counts(), { writes: 0, audits: 0 });
    const race = fixture(); race.tx.write = async () => 0;
    await assert.rejects(bind(race.ports, args), /CAS_CONFLICT/);
    assert.deepEqual(race.counts(), { writes: 0, audits: 0 });
});
test('1128 result and audit exclude body and provider config; audit failure propagates for transaction rollback', async () => {
    const bind = implementation(); const f = fixture();
    const result = await bind(f.ports, args);
    assert.equal(JSON.stringify(result).includes('accepted body'), false);
    assert.equal(result.publication_authorized, false);
    const failing = fixture(); failing.tx.audit = async () => { throw new Error('audit unavailable'); };
    await assert.rejects(bind(failing.ports, args), /audit unavailable/);
});
