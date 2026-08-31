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
