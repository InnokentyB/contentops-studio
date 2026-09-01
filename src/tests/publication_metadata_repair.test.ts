import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicationPlacementMismatchEvidence, placementRepairProvenance, planPublicationPlacementRepair } from '../services/publication_metadata_repair';

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

test('completed art-direction work with an immutable BLOCKED decision is valid mismatch evidence', () => {
    assert.equal(isPublicationPlacementMismatchEvidence({
        workItemState: 'completed',
        workItemReasonCode: null,
        workItemRevision: 1,
        expectedRevision: 1,
        expectedPlacement: 'feed',
        decision: {
            decision: 'BLOCKED',
            placement: 'feed',
            source_content_revision: 1
        }
    }), true);
    assert.equal(isPublicationPlacementMismatchEvidence({
        workItemState: 'completed',
        workItemReasonCode: null,
        workItemRevision: 1,
        expectedRevision: 1,
        expectedPlacement: 'article_cover',
        decision: {
            decision: 'BLOCKED',
            placement: 'feed',
            source_content_revision: 1
        }
    }), false);
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

test('new art-direction input references the immutable blocker only as provenance', () => {
    assert.deepEqual(placementRepairProvenance({
        blockedWorkItemId: 399,
        blockedDecisionId: 42,
        fromChannelId: 139,
        fromPlacement: 'feed'
    }), {
        superseded_blocker: {
            work_item_id: 399,
            decision_id: 42,
            channel_id: 139,
            placement: 'feed',
            immutable: true
        }
    });
});
