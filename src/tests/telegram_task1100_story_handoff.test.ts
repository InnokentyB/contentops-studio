import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffBundle } from '../services/publication_plan/handoff';
import { TASK1100_ACCEPTED_BODY, TASK1100_STORY } from '../services/telegram_task1100_story_sequence';
import type { PublicationPlan } from '../services/publication_plan/types';

function frame(id: number, order: number, sha256: string) {
    return { id, project_id: 10, content_item_id: 1100, decision_id: 304, content_revision: 4,
        placement: 'story', status: 'approved', file_url: `https://cdn.example/frame-${order}.jpg`,
        provenance: { sequence_key: TASK1100_STORY.sequenceKey, frame_count: 3, frame_index: order,
            planner_storage: { managed: true, mime_type: 'image/jpeg', width: 1080, height: 1920, sha256 },
            ...(order === 3 ? { native_link_sticker: { required: true, must_be_native_clickable: true,
                url: TASK1100_STORY.link.url, label: TASK1100_STORY.link.label,
                placement: { center_x_px: 540, center_y_px: 1495, width_px: 480, height_px: 110 } } } : {}) } };
}

function task() {
    const frames = TASK1100_STORY.assetIds.map((id, index) => frame(id, index + 1, TASK1100_STORY.hashes[index]));
    return { id: 1100, project_id: 10, channel_id: 108, type: 'publication', visual_placement: 'story',
        visual_decision_version: 4, draft_text: TASK1100_ACCEPTED_BODY, text_state: 'accepted',
        content_revision: 4, accepted_revision: 4, selected_asset_id: 155, selected_asset: frames[2],
        image_assets: frames, channel: { id: 108, name: 'spherical_analyst_tg', type: 'telegram' },
        assets: { action: { channel: 'telegram', account_ref: 'spherical_analyst_tg', action_type: 'telegram_story:publish' } } };
}

const plan: PublicationPlan = { meta: { plan_id: 'task1100' }, accounts: {}, assets: {}, actions: [] };

test('task1100 handoff exports all approved frames and the native link control', () => {
    const bundle: any = buildHandoffBundle(plan, task());
    assert.deepEqual(bundle.publication.visuals.map((visual: any) => visual.asset_id), [153, 154, 155]);
    assert.deepEqual(bundle.resource_files.map((file: any) => file.checksum_sha256), TASK1100_STORY.hashes);
    assert.deepEqual(bundle.publication.native_controls, [{ type: 'url', frame_order: 3,
        url: TASK1100_STORY.link.url, label: TASK1100_STORY.link.label, canvasWidth: 1080, canvasHeight: 1920,
        centerX: 540, centerY: 1495, width: 480, height: 110 }]);
});

test('task1100 handoff refuses a selected third frame without the full sequence', () => {
    assert.throws(() => buildHandoffBundle(plan, { ...task(), image_assets: [task().image_assets[2]] }),
        /TELEGRAM_STORY_SEQUENCE_INCOMPLETE/);
});
