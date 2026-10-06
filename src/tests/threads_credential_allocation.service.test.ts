import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ThreadsCredentialAllocationDependencies,
    ThreadsCredentialAllocationService
} from '../services/threads_credential_allocation.service';
import { encryptChannelSecret } from '../utils/channel_secrets';

function fixture(options: {
    sourceOwner?: boolean;
    targetOwner?: boolean;
    providerSuccess?: boolean;
    cas?: number;
    prior?: { before_state: unknown; after_state: unknown };
    legacySource?: boolean;
} = {}) {
    process.env.CHANNEL_SECRETS_KEY = 'test-only-channel-secret-key-at-least-32-chars';
    const sourceConfig = options.legacySource ? {
        threads_user_id: '39420001',
        access_token: 'legacy-threads-provider-token'
    } : {
        threads_user_id: '39420001',
        access_token_encrypted: encryptChannelSecret('threads-provider-token')
    };
    const events: Array<{ data: Record<string, unknown> }> = [];
    const updates: unknown[] = [];
    const target = { id: 138, project_id: 10, type: 'threads', name: 'innokenty_threads',
        updated_at: new Date('2026-10-06T12:00:00.000Z'), config: { workflow_mode: 'approval_required' } };
    const source = { id: 176, project_id: 32, type: 'threads', name: 'IB Threads auto',
        updated_at: new Date('2026-10-06T11:00:00.000Z'), config: sourceConfig };
    const tx = {
        projectMember: { findUnique: async ({ where }: { where: { project_id_user_id: { project_id: number } } }) => ({
            role: where.project_id_user_id.project_id === 32
                ? (options.sourceOwner === false ? 'member' : 'owner')
                : (options.targetOwner === false ? 'member' : 'owner')
        }) },
        socialChannel: {
            findFirst: async ({ where }: { where: { id: number } }) => where.id === 176 ? source : target,
            updateMany: async (args: unknown) => { updates.push(args); return { count: options.cas ?? 1 }; }
        },
        workflowEvent: {
            findFirst: async () => options.prior || null,
            create: async ({ data }: { data: Record<string, unknown> }) => { events.push({ data }); return data; }
        }
    };
    const db = { $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) };
    const threads = { testConnection: async () => options.providerSuccess === false
        ? { success: false, error: 'invalid token' }
        : { success: true, details: { id: '39420001', username: 'innokentybo' } } };
    return { service: new ThreadsCredentialAllocationService({
        db: db as unknown as ThreadsCredentialAllocationDependencies['db'],
        threads
    }), events, updates };
}

const request = {
    actorId: 'user:7', sourceProjectId: 32, sourceChannelId: 176,
    targetProjectId: 10, targetChannelId: 138,
    expectedSourceUpdatedAt: '2026-10-06T11:00:00.000Z',
    expectedTargetUpdatedAt: '2026-10-06T12:00:00.000Z',
    idempotencyKey: 'threads-allocation-176-138-v1'
};

test('owner allocation verifies identity, performs CAS and audits without exposing the token', async () => {
    const { service, events } = fixture();
    const result = await service.allocate(request);

    assert.equal(result.source_channel_id, 176);
    assert.equal(result.target_channel_id, 138);
    assert.equal(result.username, 'innokentybo');
    assert.equal(JSON.stringify(result).includes('threads-provider-token'), false);
    assert.equal(JSON.stringify(events).includes('threads-provider-token'), false);
    assert.equal(events.length, 1);
});

test('allocation requires the same user to own both source and target projects', async () => {
    await assert.rejects(() => fixture({ sourceOwner: false }).service.allocate(request), /OWNER_REQUIRED/);
    await assert.rejects(() => fixture({ targetOwner: false }).service.allocate(request), /OWNER_REQUIRED/);
});

test('allocation fails closed when provider identity cannot be verified or CAS loses', async () => {
    await assert.rejects(() => fixture({ providerSuccess: false }).service.allocate(request), /IDENTITY_VERIFICATION_FAILED/);
    await assert.rejects(() => fixture({ cas: 0 }).service.allocate(request), /CAS_CONFLICT/);
});

test('allocation replays the audited result for the same idempotent request', async () => {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const priorResult = {
        source_project_id: 32, source_channel_id: 176,
        target_project_id: 10, target_channel_id: 138,
        threads_user_id: '39420001', username: 'innokentybo',
        provider_identity_verified: true, replayed: false
    };
    const { service } = fixture({ prior: {
        before_state: { request_hash: hash },
        after_state: priorResult
    } });

    const replay = await service.allocate(request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.target_channel_id, 138);
});

test('exact legacy source migration encrypts in place and audits without exposing plaintext', async () => {
    const { service, events, updates } = fixture({ legacySource: true });
    const result = await service.migrateLegacySource({
        actorId: 'user:7', projectId: 32, channelId: 176,
        expectedUpdatedAt: '2026-10-06T11:00:00.000Z',
        idempotencyKey: 'threads-encrypt-176-v1'
    });

    assert.equal(result.encrypted_at_rest, true);
    assert.equal(JSON.stringify(events).includes('legacy-threads-provider-token'), false);
    assert.equal(JSON.stringify(result).includes('legacy-threads-provider-token'), false);
    assert.equal(JSON.stringify(updates).includes('legacy-threads-provider-token'), false);
    assert.match(JSON.stringify(updates), /access_token_encrypted/);
});
