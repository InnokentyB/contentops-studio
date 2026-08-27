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
