import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedContentItemHandoff, buildHandoffBundle } from '../services/publication_plan/handoff';
import { canonicalPlacementsForChannel, publicationPlacementAssetContract } from '../services/publication_placement_contract';
import { PublicationPlan } from '../services/publication_plan/types';

const hash = 'a'.repeat(64);
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 2000, draft_text: 'Accepted clip caption', text_state: 'accepted',
        content_revision: 2, accepted_revision: 2, visual_placement: 'clip',
        channel: { name: 'vk_group', type: 'vk' }, selected_asset_id: 200,
        selected_asset: { id: 200, status: 'approved', content_revision: 2,
            file_url: 'https://example.com/approved.mp4',
            provenance: { planner_storage: { mime_type: 'video/mp4', sha256: hash, byte_size: 1234, width: 1080, height: 1920 } } },
        ...overrides
    };
}
const plan: PublicationPlan = { meta: { plan_id: 'clip-plan' }, accounts: {}, assets: {}, actions: [] };

test('VK Clip is an explicit canonical artifact and transport with manual authority', () => {
    assert.ok(canonicalPlacementsForChannel({ type: 'vk' }).includes('clip'));
    const contract = publicationPlacementAssetContract({ type: 'vk' }, 'clip');
    assert.equal(contract.artifact_kind, 'clip');
    assert.equal(contract.transport.materialization, 'clip');
    assert.equal(contract.transport.connector_authority, 'manual_only');
    assert.deepEqual(contract.accepted_mime_types, ['video/mp4']);
});

test('generated and imported clip handoffs bind the selected MP4 and accepted revision', () => {
    for (const bundle of [buildGeneratedContentItemHandoff(item()), buildHandoffBundle(plan, item())]) {
        assert.equal(bundle.task.action_type, 'vk_clip:publish');
        assert.equal(bundle.task.placement, 'clip');
        assert.equal(bundle.mode, 'manual');
        assert.equal(bundle.publication.image_url, null);
        assert.equal(bundle.publication.video_url, 'https://example.com/approved.mp4');
        assert.equal(bundle.publication.content_binding?.accepted_revision, 2);
        assert.equal(bundle.resource_files[0]?.checksum_sha256, hash);
        assert.equal(bundle.resource_files[0]?.type, 'video');
    }
});

test('clip handoff refuses missing, stale, image and unhashed assets even without optional acceptance flag', () => {
    for (const builder of [(value: Record<string, unknown>) => buildGeneratedContentItemHandoff(value),
        (value: Record<string, unknown>) => buildHandoffBundle(plan, value)]) {
        assert.throws(() => builder(item({ selected_asset_id: null, selected_asset: null })), /VK_CLIP_MP4_REQUIRED/);
        assert.throws(() => builder(item({ text_state: 'draft' })), /ACCEPTED_REVISION_REQUIRED/);
        assert.throws(() => builder(item({ selected_asset: { id: 200, status: 'approved', content_revision: 1 } })), /APPROVED_VISUAL_REQUIRED/);
        assert.throws(() => builder(item({ selected_asset: { id: 200, status: 'approved', content_revision: 2,
            file_url: 'https://example.com/image.jpg', provenance: { planner_storage: { mime_type: 'image/jpeg', sha256: hash } } } })), /VK_CLIP_MP4_REQUIRED/);
        assert.throws(() => builder(item({ selected_asset: { id: 200, status: 'approved', content_revision: 2,
            file_url: 'https://example.com/video.mp4', provenance: { planner_storage: { mime_type: 'video/mp4' } } } })), /VK_CLIP_ASSET_HASH_REQUIRED/);
    }
});

test('legacy VK feed MP4 remains ordinary video without implicit clip conversion', () => {
    const bundle = buildGeneratedContentItemHandoff(item({ id: 1084, visual_placement: 'feed' }));
    assert.equal(bundle.task.action_type, 'vk_video:publish');
    assert.equal(bundle.task.placement, 'feed');
    assert.equal(bundle.transport.materialization, 'video');
});
