import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmVkBrowserSubmission } from '../services/vk_browser_submission_control.service';

function fixture() {
    const facts: unknown[] = [];
    const release = { publication_authorized: true, approval_reference: 'owner-approved-exact-clip',
        content_revision: 2, body_sha256: 'a'.repeat(64), selected_asset_id: 18,
        asset_sha256: 'b'.repeat(64), channel_id: 117, placement: 'clip' };
    const task = { id: 900, project_id: 10, channel_id: 117, status: 'publishing',
        publication_mode: 'browser_required', content_revision: 2, accepted_revision: 2,
        text_state: 'accepted', visual_state: 'APPROVED', visual_placement: 'clip',
        draft_text: 'Accepted clip', selected_asset_id: 18, updated_at: new Date('2026-10-09T10:01:00Z'),
        selected_asset: { id: 18, file_url: 'https://storage.example/clip.mp4', status: 'approved', content_revision: 2,
            provenance: { planner_storage: { sha256: 'b'.repeat(64), mime_type: 'video/mp4',
                width: 1080, height: 1920, byte_size: 100 } } },
        channel: { id: 117, type: 'vk', config: { vk_id: '-240051152' } },
        publication_fact: null, published_link: null };
    const attempt = { id: 77, status: 'pending', created_at: new Date('2026-10-09T10:01:00Z') };
    const work = { id: 501, project_id: 10, content_item_id: 900, kind: 'browser_publish',
        assignee_role: 'browser_publisher', state: 'claimed', lease_token: 'test-lease',
        lease_actor_id: 'user:2', lease_expires_at: new Date('2026-10-09T12:00:00Z'), result_payload: release };
    const tx = { workItem: { findFirst: async () => work }, contentItem: { findFirst: async () => task },
        deliveryAttempt: { findFirst: async () => attempt, updateMany: async () => ({ count: 1 }) },
        workflowEvent: { create: async () => ({ id: 1 }) } };
    const deps: Parameters<typeof confirmVkBrowserSubmission>[0] = {
        transaction: async callback => callback(tx), now: () => new Date('2026-10-09T10:03:00Z'),
        hashBody: () => 'a'.repeat(64), recordFact: async (value: unknown) => {
            facts.push(value); return { publication_fact: { id: 42 } };
        }
    };
    const args = { projectId: 10, taskId: 900, channelId: 117, actorId: 'user:2', workItemId: 501,
        leaseToken: 'test-lease', approvalReference: release.approval_reference, idempotencyKey: 'exact-clip-r2',
        contentRevision: 2, textSha256: 'a'.repeat(64), imageSha256: 'b'.repeat(64), selectedAssetId: 18,
        placement: 'clip' as const, attemptId: 77, publicUrl: 'https://vk.com/clip-240051152_81',
        providerObjectId: 'clip-240051152_81', publishedAt: '2026-10-09T10:02:00Z', evidenceSha256: 'c'.repeat(64),
        providerKind: 'short_video', providerTimestampSource: 'provider',
        clipBaselineCapturedAt: '2026-10-09T10:00:00Z', clipBaselineObjectIds: ['clip-240051152_80'],
        clipSubmissionStartedAt: '2026-10-09T10:01:01Z', readbackObservedAt: '2026-10-09T10:02:30Z',
        clipMediaSha256: 'b'.repeat(64) };
    const confirm = (changes: Record<string, unknown> = {}): Promise<unknown> =>
        confirmVkBrowserSubmission(deps, { ...args, ...changes });
    return { facts, args, confirm, task, work, attempt };
}

test('exact fresh Clip proof records one video fact with a Clip permalink', async () => {
    const f = fixture();
    await f.confirm();
    assert.equal(f.facts.length, 1);
    assert.equal(Reflect.get(Object(f.facts[0]), 'artifactKind'), 'video');
    assert.equal(Reflect.get(Object(f.facts[0]), 'publicUrl'), f.args.publicUrl);
    const guard = Reflect.get(Object(f.facts[0]), 'clipConfirmation');
    assert.equal(Reflect.get(Object(guard), 'expectedUpdatedAt'), f.task.updated_at.toISOString());
    assert.equal(Reflect.get(Object(guard), 'expectedOwnerId'), '-240051152');
});

test('Clip confirmation rejects absent or mismatched proof without writing a fact', async () => {
    for (const changes of [
        { providerKind: undefined }, { providerKind: 'video' }, { providerTimestampSource: 'local_clock' },
        { clipMediaSha256: 'd'.repeat(64) }, { clipBaselineObjectIds: ['clip-240051152_81'] },
        { publishedAt: '2026-10-08T10:02:00Z' }, { readbackObservedAt: '2026-10-10T10:02:00Z' },
        { clipBaselineCapturedAt: '2026-10-09T10:02:00Z' },
        { clipSubmissionStartedAt: '2026-10-09T09:59:00Z' },
        { publicUrl: 'https://vk.com/video-240051152_81' },
        { publicUrl: 'https://vk.com/clip-99_81', providerObjectId: 'clip-99_81' },
        { publicUrl: 'https://vk.com:444/clip-240051152_81' },
        { publicUrl: 'https://vk.com:443/clip-240051152_81' }
    ]) {
        const f = fixture();
        await assert.rejects(f.confirm(changes), /VK_CLIP_/);
        assert.equal(f.facts.length, 0);
    }
});

test('cancelled Clip or stale revision is never confirmed from valid provider proof', async () => {
    const f = fixture(); f.task.status = 'cancelled';
    await assert.rejects(f.confirm(), /SUBMISSION_GUARD_FAILED/); assert.equal(f.facts.length, 0);
    const g = fixture(); g.task.accepted_revision = 1;
    await assert.rejects(g.confirm(), /SUBMISSION_GUARD_FAILED/); assert.equal(g.facts.length, 0);
});
