import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublicationPlacementRepair } from '../services/publication_metadata_repair';

test('placement repair creates a new revision-bound art-direction input without changing content revision', () => {
    assert.deepEqual(planPublicationPlacementRepair({
        contentItemId: 726,
        contentRevision: 2,
        acceptedRevision: 2,
        currentChannelId: 139,
        targetChannelId: 113,
        currentPlacement: 'feed',
        targetPlacement: 'article_cover'
    }), {
        contentRevision: 2,
        acceptedRevision: 2,
        channelId: 113,
        placement: 'article_cover',
        artDirectionState: 'available',
        inputContextVersion: 2,
        dedupeKey: 'art-direction:726:2:article_cover',
        note: 'Assess visual fit for revision 2, placement article_cover'
    });
});

test('placement repair refuses to operate on a stale accepted revision', () => {
    assert.throws(() => planPublicationPlacementRepair({
        contentItemId: 726,
        contentRevision: 2,
        acceptedRevision: 1,
        currentChannelId: 139,
        targetChannelId: 113,
        currentPlacement: 'feed',
        targetPlacement: 'article_cover'
    }), /CURRENT_REVISION_NOT_ACCEPTED/);
});
