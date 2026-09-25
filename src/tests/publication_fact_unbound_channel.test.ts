import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationFactChannelPolicy } from '../services/publication_fact.service';

test('provider-confirmed manual publication may be reconciled without inventing a channel binding', () => {
    const policy = publicationFactChannelPolicy({
        id: 976, channel_id: null, content_revision: 4, accepted_revision: 4,
        text_state: 'accepted', status: 'ready_for_execution', selected_asset_id: 83,
        publication_mode: 'approval_required', publication_fact: null
    });
    assert.deepEqual(policy, { channel_id: null, create_metric_checkpoints: false });
});

test('unaccepted or terminal slot is not eligible for unbound-channel reconciliation', () => {
    for (const item of [
        { id: 1, channel_id: null, content_revision: 4, accepted_revision: 3, text_state: 'draft', status: 'ready_for_execution' },
        { id: 1, channel_id: null, content_revision: 4, accepted_revision: 4, text_state: 'accepted', status: 'removed' }
    ]) assert.throws(() => publicationFactChannelPolicy(item), /PUBLICATION_FACT_TASK_NOT_ELIGIBLE/);
});
