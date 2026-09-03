import {
    publicationPlacementAssetContract,
    publicationPlacementManualChecklistNotes
} from './publication_placement_contract';

export function planPublicationPlacementRepair(input: {
    contentItemId: number;
    contentRevision: number;
    acceptedRevision: number | null;
    currentChannelId: number | null;
    targetChannelId: number;
    currentPlacement: string | null;
    targetPlacement: string;
}) {
    if (input.acceptedRevision !== input.contentRevision) {
        throw new Error('[CURRENT_REVISION_NOT_ACCEPTED] Placement repair requires the current accepted revision');
    }
    return {
        contentRevision: input.contentRevision,
        acceptedRevision: input.acceptedRevision,
        channelId: input.targetChannelId,
        placement: input.targetPlacement,
        artDirectionState: 'available',
        inputContextVersion: input.contentRevision,
        dedupeKey: `art-direction:${input.contentItemId}:${input.contentRevision}:${input.targetPlacement}`,
        note: `Assess visual fit for revision ${input.contentRevision}, placement ${input.targetPlacement}`
    };
}

export function isPublicationPlacementMismatchEvidence(input: {
    workItemState: string;
    workItemReasonCode?: string | null;
    workItemRevision: number;
    expectedRevision: number;
    expectedPlacement: string;
    decision?: {
        decision: string;
        placement: string;
        source_content_revision: number;
    } | null;
}) {
    if (input.workItemRevision !== input.expectedRevision) return false;
    if (input.workItemState === 'blocked' && input.workItemReasonCode === 'channel_placement_mismatch') return true;
    return input.workItemState === 'completed'
        && input.decision?.decision === 'BLOCKED'
        && input.decision.placement === input.expectedPlacement
        && input.decision.source_content_revision === input.expectedRevision;
}

export function placementRepairProvenance(input: {
    blockedWorkItemId: number;
    blockedDecisionId: number | null;
    fromChannelId: number | null;
    fromPlacement: string | null;
}) {
    return {
        superseded_blocker: {
            work_item_id: input.blockedWorkItemId,
            decision_id: input.blockedDecisionId,
            channel_id: input.fromChannelId,
            placement: input.fromPlacement,
            immutable: true
        }
    };
}

type CanonicalPublicationChannel = {
    id: number;
    name: string;
    type: string;
};

export function canonicalStoryActionType(channelType: string, placement: string) {
    return `${String(channelType || 'unknown').toLowerCase()}_${String(placement || 'feed').toLowerCase()}:publish`;
}

/**
 * Rebuilds denormalized routing metadata from the durable ContentItem channel
 * binding. Content, schedule, visual decisions and asset records are deliberately
 * outside this projection and cannot be changed by this helper.
 */
export function repairMaterializedPublicationProjection(input: {
    assets?: any;
    qualityReport?: any;
    metrics?: any;
    channel: CanonicalPublicationChannel;
    placement: string;
}) {
    const assets = { ...(input.assets || {}) };
    const action = { ...(assets.action || {}) };
    const qualityReport = { ...(input.qualityReport || {}) };
    const handoffBundle = qualityReport.handoff_bundle
        ? { ...qualityReport.handoff_bundle }
        : null;
    const actionType = input.placement === 'story'
        ? canonicalStoryActionType(input.channel.type, input.placement)
        : input.channel.type === 'vk' && input.placement === 'article_cover'
            ? 'vk_article:publish'
        : (action.action_type || handoffBundle?.task?.action_type || null);

    assets.account_ref = input.channel.name;
    assets.action = {
        ...action,
        account_ref: input.channel.name,
        channel: input.channel.type,
        action_type: actionType
    };

    if (handoffBundle) {
        const placementContract = publicationPlacementAssetContract(input.channel, input.placement);
        const currentChecklist = Array.isArray(handoffBundle.manual_checklist)
            ? [...handoffBundle.manual_checklist]
            : [];
        const repairedChecklist = currentChecklist.length > 0
            ? [`Post from account: ${input.channel.name}`, ...currentChecklist.slice(1)]
            : [`Post from account: ${input.channel.name}`];
        const notes = publicationPlacementManualChecklistNotes(placementContract);
        const manualChecklist = [
            repairedChecklist[0],
            ...notes.filter((note) => !repairedChecklist.includes(note)),
            ...repairedChecklist.slice(1)
        ];
        handoffBundle.account = {
            ...(handoffBundle.account || {}),
            ref: input.channel.name,
            details: {
                ...(handoffBundle.account?.details || {}),
                platform: input.channel.type
            }
        };
        handoffBundle.task = {
            ...(handoffBundle.task || {}),
            channel: input.channel.type,
            action_type: actionType,
            placement: input.placement
        };
        handoffBundle.mode = placementContract.transport.connector_authority === 'manual_only'
            ? 'manual'
            : handoffBundle.mode;
        handoffBundle.placement_contract = placementContract;
        handoffBundle.transport = placementContract.transport;
        handoffBundle.manual_checklist = manualChecklist;
        qualityReport.handoff_bundle = handoffBundle;
    }

    return {
        assets,
        qualityReport,
        metrics: {
            ...(input.metrics || {}),
            account_ref: input.channel.name
        }
    };
}
