import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { runVkNativeVideo, type VkVideoPorts } from '../services/vk_native_video_adapter';

function fixture() {
    const calls: string[] = [];
    const bytes = Buffer.from('approved fixture');
    const input = { ownerId: -240051152, body: 'Accepted body', title: 'Approved video', bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'), idempotencyKey: 'video1084-r1',
        policyCleared: true, videoCapabilityEnabled: true };
    const ports: VkVideoPorts = {
        claim: async () => true,
        checkpoint: async state => { calls.push(state.stage); },
        save: async () => { calls.push('save'); return { owner_id: input.ownerId, video_id: 41,
            upload_url: 'https://pu.vk.com/upload?private=redacted' }; },
        upload: async () => { calls.push('upload'); },
        get: async () => ({ owner_id: input.ownerId, id: 41, processing: false }),
        wallPost: async args => { calls.push(args.attachments); return { post_id: 70 }; },
        readWallPost: async () => ({ owner_id: input.ownerId, id: 70, video_owner_id: input.ownerId, video_id: 41 })
    };
    return { input, ports, calls };
}
test('video adapter has no side effects when policy or capability is unavailable', async () => {
    for (const key of ['policyCleared', 'videoCapabilityEnabled'] as const) {
        const f = fixture();
        await assert.rejects(runVkNativeVideo({ ...f.input, [key]: false }, f.ports), /VIDEO_ROUTE_NOT_AUTHORIZED/);
        assert.deepEqual(f.calls, []);
    }
});
test('native video mocks follow save/upload/readback/wall and checkpoint no upload secret', async () => {
    const f = fixture();
    const result = await runVkNativeVideo(f.input, f.ports);
    assert.equal(result.public_url, 'https://vk.com/wall-240051152_70');
    assert.ok(f.calls.includes('video-240051152_41'));
    assert.equal(f.calls.includes('confirmed'), true);
    assert.equal(JSON.stringify(f.calls).includes('private'), false);
});
test('processing video cannot create a wall post; an uncertain submit cannot be retried', async () => {
    const f = fixture();
    f.ports.get = async () => ({ owner_id: f.input.ownerId, id: 41, processing: true });
    assert.equal((await runVkNativeVideo(f.input, f.ports)).stage, 'processing');
    assert.equal(f.calls.some(c => c.startsWith('video-')), false);
    const g = fixture();
    g.ports.wallPost = async () => { throw new Error('provider secret must not escape'); };
    await assert.rejects(runVkNativeVideo(g.input, g.ports), /VK_VIDEO_PROVIDER_UNCERTAIN/);
    assert.equal(g.calls[g.calls.length - 1], 'uncertain');
    const replay = fixture();
    replay.ports.claim = async () => false;
    await assert.rejects(runVkNativeVideo(replay.input, replay.ports), /ALREADY_CLAIMED/);
    assert.deepEqual(replay.calls, []);
});
