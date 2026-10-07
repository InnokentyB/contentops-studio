import { createHash } from 'crypto';

type Identity = { owner_id: number; video_id: number };
type Checkpoint = { stage: 'allocated' | 'uploaded' | 'processing' | 'posting' | 'confirmed' | 'uncertain';
    idempotency_key: string; source_sha256: string; identity?: Identity; post_id?: number };
export type VkVideoPorts = {
    /** Durable atomic claim: false for every replay, including an uncertain attempt. */
    claim(key: string, sha256: string): Promise<boolean>;
    checkpoint(state: Checkpoint): Promise<void>;
    save(args: { group_id: number; name: string; description: string; wallpost: 0 }): Promise<Identity & { upload_url: string }>;
    upload(url: string, field: 'video_file', bytes: Buffer): Promise<void>;
    /** Provider implementation must normalize and verify the exact video.get object. */
    get(identity: Identity): Promise<{ owner_id: number; id: number; processing: boolean }>;
    wallPost(args: { owner_id: number; message: string; attachments: string; guid: string }): Promise<{ post_id: number }>;
    readWallPost(ownerId: number, postId: number): Promise<{ owner_id: number; id: number; video_owner_id: number; video_id: number }>;
};
type Input = { ownerId: number; body: string; title: string; bytes: Buffer; sha256: string;
    idempotencyKey: string; policyCleared: boolean; videoCapabilityEnabled: boolean };

/** Offline orchestration contract. Deliberately not registered in live publication dispatch. */
export async function runVkNativeVideo(input: Input, ports: VkVideoPorts) {
    if (!input.policyCleared || !input.videoCapabilityEnabled) throw new Error('[VIDEO_ROUTE_NOT_AUTHORIZED]');
    if (!Number.isSafeInteger(input.ownerId) || input.ownerId >= 0 || !input.body.trim()
        || !input.title.trim() || !input.idempotencyKey.trim()) throw new Error('[VK_VIDEO_INPUT_INVALID]');
    const sha = createHash('sha256').update(input.bytes).digest('hex');
    if (!input.bytes.length || input.bytes.length > 200 * 1024 * 1024 || sha !== input.sha256) {
        throw new Error('[VK_VIDEO_SOURCE_MISMATCH]');
    }
    if (!await ports.claim(input.idempotencyKey, sha)) throw new Error('[VK_VIDEO_ATTEMPT_ALREADY_CLAIMED]');
    const base = { idempotency_key: input.idempotencyKey, source_sha256: sha };
    let identity: Identity | undefined;
    try {
        const allocated = await ports.save({ group_id: -input.ownerId, name: input.title,
            description: input.body, wallpost: 0 });
        if (allocated.owner_id !== input.ownerId || !Number.isSafeInteger(allocated.video_id) || allocated.video_id <= 0) {
            throw new Error('identity mismatch');
        }
        identity = { owner_id: allocated.owner_id, video_id: allocated.video_id };
        const url = new URL(allocated.upload_url);
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || !['vk.com', 'userapi.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
            throw new Error('untrusted upload endpoint');
        }
        await ports.checkpoint({ ...base, stage: 'allocated', identity });
        // Upload URL can contain provider secrets: pass only to the upload port, never checkpoint it.
        await ports.upload(allocated.upload_url, 'video_file', input.bytes);
        await ports.checkpoint({ ...base, stage: 'uploaded', identity });
        const video = await ports.get(identity);
        if (video.owner_id !== identity.owner_id || video.id !== identity.video_id) throw new Error('readback mismatch');
        if (video.processing !== false) {
            await ports.checkpoint({ ...base, stage: 'processing', identity });
            return { stage: 'processing' as const, identity, public_url: null };
        }
        await ports.checkpoint({ ...base, stage: 'posting', identity });
        const post = await ports.wallPost({ owner_id: input.ownerId, message: input.body,
            attachments: `video${identity.owner_id}_${identity.video_id}`,
            guid: createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16) });
        if (!Number.isSafeInteger(post.post_id) || post.post_id <= 0) throw new Error('invalid post identity');
        const readback = await ports.readWallPost(input.ownerId, post.post_id);
        if (readback.owner_id !== input.ownerId || readback.id !== post.post_id
            || readback.video_owner_id !== identity.owner_id || readback.video_id !== identity.video_id) {
            throw new Error('wall readback mismatch');
        }
        await ports.checkpoint({ ...base, stage: 'confirmed', identity, post_id: post.post_id });
        return { stage: 'confirmed' as const, identity, post_id: post.post_id,
            public_url: `https://vk.com/wall${input.ownerId}_${post.post_id}` };
    } catch {
        await ports.checkpoint({ ...base, stage: 'uncertain', ...(identity ? { identity } : {}) });
        // Intentional fail-closed boundary: raw provider errors may contain signed URLs or tokens.
        throw new Error('[VK_VIDEO_PROVIDER_UNCERTAIN] Verify provider identity; do not replay the upload or post');
    }
}
