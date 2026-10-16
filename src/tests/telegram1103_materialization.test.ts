import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedContentItemHandoff, buildHandoffBundle } from '../services/publication_plan/handoff';
import { publicationPlacementAssetContract, canonicalPlacementsForChannel } from '../services/publication_placement_contract';

const sha = '23a3dc6208457cb78de4a8e92ee995a67d682ecec9cec703cb38ad53b5730b43';
const item = { id: 1103, content_revision: 2, accepted_revision: 2, text_state: 'accepted',
    visual_placement: 'video_cover', selected_asset_id: 142, draft_text: 'Approved video caption',
    channel: { type: 'telegram', name: 'analystcraft', config: { execution_modes: ['automated', 'manual'] } },
    selected_asset: { id: 142, content_revision: 2, status: 'approved',
        file_url: 'https://media.example.invalid/original.mp4', provenance: {
            planner_storage: { managed: true, mime_type: 'video/mp4', sha256: sha } } } };

test('Telegram MP4 materializes as video, never an image, in both canonical builders', () => {
    const generated = buildGeneratedContentItemHandoff(item);
    assert.equal(generated.publication.image_url, null);
    assert.equal(generated.publication.video_url, item.selected_asset.file_url);
    assert.equal(generated.resource_files[0].type, 'video');
    assert.equal(generated.resource_files[0].checksum_sha256, sha);
    const imported = buildHandoffBundle({ meta: { plan_id: 'synthetic' }, accounts: {}, actions: [], assets: {} },
        { ...item, assets: { action: { id: 'video', channel: 'telegram', action_type: 'telegram_post:publish' } } });
    assert.equal(imported.publication.image_url, null);
    assert.equal(imported.publication.video_url, item.selected_asset.file_url);
    assert.equal(imported.resource_files.find(r => r.ref === 'selected_asset')?.type, 'video');
    assert.equal(imported.task.action_type,'telegram_video:publish');
});

test('Telegram video contract is canonical; JPEG feed and Story keep their existing meaning', () => {
    assert.ok(canonicalPlacementsForChannel(item.channel).includes('video_cover'));
    const c = publicationPlacementAssetContract(item.channel, 'video_cover', { mime_type: 'video/mp4' });
    assert.equal(c.artifact_kind, 'video');
    assert.equal(c.transport.materialization, 'video');
    assert.deepEqual(c.accepted_mime_types, ['video/mp4']);
    assert.equal(c.transport.connector_authority,'manual_only');
    assert.equal(publicationPlacementAssetContract(item.channel,'feed',{mime_type:'video/mp4'}).transport.connector_authority,'manual_only');
    assert.equal(publicationPlacementAssetContract(item.channel, 'feed', { mime_type: 'image/jpeg' }).artifact_kind, 'feed');
    assert.equal(publicationPlacementAssetContract(item.channel, 'story', { mime_type: 'video/mp4' }).artifact_kind, 'story');
});
