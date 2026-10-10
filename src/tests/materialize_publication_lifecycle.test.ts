import test from 'node:test';
import assert from 'node:assert/strict';
import { materializedPublicationStatus } from '../services/materialized_publication_status';

const accepted = { status: 'approved', draft_text: 'accepted Telegram body', text_state: 'accepted',
    content_revision: 1, accepted_revision: 1, channel_id: 109, brief: 'accepted brief' };

test('schedule-only materialization preserves an exact accepted reviewed package status', () => {
    assert.equal(materializedPublicationStatus(accepted, undefined, 109), 'approved');
    assert.equal(materializedPublicationStatus(accepted, 'accepted Telegram body', 109), 'approved');
});

test('materialization still reopens lifecycle when body or channel changes', () => {
    assert.equal(materializedPublicationStatus(accepted, 'changed body', 109), 'drafted');
    assert.equal(materializedPublicationStatus(accepted, 'accepted Telegram body', 110), 'drafted');
    assert.equal(materializedPublicationStatus(accepted, 'accepted Telegram body', 109, 'changed brief'), 'drafted');
});
