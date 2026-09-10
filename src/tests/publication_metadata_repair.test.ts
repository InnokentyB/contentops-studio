import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isPublicationPlacementMismatchEvidence,
    placementRepairProvenance,
    planPublicationPlacementRepair,
    repairMaterializedPublicationProjection
} from '../services/publication_metadata_repair';
import {
    assertCanonicalPublicationPlacement,
    publicationPlacementAssetContract
} from '../services/publication_placement_contract';

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

test('blocked Medium work with the missing-channel-contract reason is valid repair evidence', () => {
    assert.equal(isPublicationPlacementMismatchEvidence({
        workItemState: 'blocked',
        workItemReasonCode: 'missing_medium_channel_article_cover_contract',
        workItemRevision: 3,
        expectedRevision: 3,
        expectedPlacement: 'feed'
    }), true);
});

test('blocked feed work with a missing asset contract creates a distinct recovery input', () => {
    assert.equal(isPublicationPlacementMismatchEvidence({
        workItemState: 'blocked',
        workItemReasonCode: 'missing_feed_asset_contract',
        workItemRevision: 1,
        expectedRevision: 1,
        expectedPlacement: 'feed'
    }), true);
    assert.equal(planPublicationPlacementRepair({
        contentItemId: 907,
        contentRevision: 1,
        acceptedRevision: 1,
        currentChannelId: 126,
        targetChannelId: 126,
        currentPlacement: 'feed',
        targetPlacement: 'feed',
        replacementKeySuffix: 'contract-recovery:685'
    }).dedupeKey, 'art-direction:907:1:feed:contract-recovery:685');
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

test('Medium article cover has an explicit manual-only visual contract', () => {
    assert.equal(assertCanonicalPublicationPlacement({ type: 'medium' }, 'article_cover'), 'article_cover');
    assert.throws(
        () => assertCanonicalPublicationPlacement({ type: 'medium' }, 'feed'),
        /TARGET_PLACEMENT_MISMATCH/
    );
    assert.deepEqual(publicationPlacementAssetContract({ type: 'medium' }, 'article_cover'), {
        placement: 'article_cover',
        artifact_kind: 'article_cover',
        dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
        safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
        poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
        transport: { materialization: 'article', connector_authority: 'manual_only' }
    });
});

test('Medium placement repair rematerializes a manual article handoff', () => {
    const repaired = repairMaterializedPublicationProjection({
        assets: {
            action: {
                id: 'medium-article',
                channel: 'operational',
                account_ref: null,
                action_type: 'operational_feed:publish'
            }
        },
        qualityReport: {
            handoff_bundle: {
                mode: 'manual',
                account: { ref: null, details: {} },
                task: { channel: 'operational', action_type: 'operational_feed:publish', placement: 'feed' },
                manual_checklist: ['Post from account: specified account in plan']
            }
        },
        metrics: { account_ref: null },
        channel: { id: 200, name: 'innokenty_medium', type: 'medium' },
        placement: 'article_cover'
    });

    assert.equal(repaired.assets.account_ref, 'innokenty_medium');
    assert.equal(repaired.assets.action.channel, 'medium');
    assert.equal(repaired.assets.action.action_type, 'medium:manual_content');
    assert.equal(repaired.qualityReport.handoff_bundle.account.ref, 'innokenty_medium');
    assert.equal(repaired.qualityReport.handoff_bundle.task.placement, 'article_cover');
    assert.equal(repaired.qualityReport.handoff_bundle.placement_contract.transport.connector_authority, 'manual_only');
    assert.equal(repaired.metrics.account_ref, 'innokenty_medium');
});
