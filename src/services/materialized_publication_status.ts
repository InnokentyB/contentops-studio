export type MaterializedPublicationState = {
    status: string;
    draft_text: string | null;
    text_state: string;
    content_revision: number;
    accepted_revision: number | null;
    channel_id: number | null;
    brief?: string | null;
    handoff_state?: string;
    visual_state?: string;
};

/** Preserve lifecycle only when rematerialization leaves the accepted package unchanged. */
export function materializedPublicationStatus(existing: MaterializedPublicationState | null | undefined,
    draftText?: string, channelId?: number, brief?: string): string {
    if (!existing) return draftText?.trim() ? 'drafted' : 'planned';
    const unchangedAcceptedPackage = existing.text_state === 'accepted'
        && existing.accepted_revision === existing.content_revision
        && (draftText === undefined || draftText === existing.draft_text)
        && (channelId === undefined || channelId === existing.channel_id)
        && (brief === undefined || brief === existing.brief)
        && existing.handoff_state === 'ready'
        && ['APPROVED', 'NO_VISUAL_NEEDED'].includes(existing.visual_state || '');
    if (unchangedAcceptedPackage) {
        return ['drafted', 'revised'].includes(existing.status) ? 'approved' : existing.status;
    }
    return draftText?.trim() ? 'drafted' : existing.status;
}
