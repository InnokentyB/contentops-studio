import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelSupersededVisualWork } from '../services/image_asset.service';

test('approved durable asset cancels only actionable visual work for its revision and decision or placement', async () => {
    let update: any;
    await cancelSupersededVisualWork({
        workItem: {
            updateMany: async (args: any) => {
                update = args;
                return { count: 2 };
            }
        }
    }, {
        id: 22,
        project_id: 10,
        content_item_id: 842,
        content_revision: 2,
        placement: 'telegram_feed',
        decision_id: 32
    });

    assert.equal(update.where.project_id, 10);
    assert.equal(update.where.content_item_id, 842);
    assert.equal(update.where.input_context_version, 2);
    assert.deepEqual(update.where.kind.in, ['visual_generate', 'visual_review']);
    assert.deepEqual(update.where.state.notIn, ['completed', 'cancelled']);
    assert.deepEqual(update.where.OR[1].result_payload, { path: ['decision_id'], equals: 32 });
    assert.equal(update.data.state, 'cancelled');
    assert.equal(update.data.reason_code, 'superseded_by_selected_asset');
    assert.equal(update.data.lease_token, null);
});
