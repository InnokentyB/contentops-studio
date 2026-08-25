export type PublicationGenerationStage =
    | 'topic_approval'
    | 'writing'
    | 'content_review'
    | 'visual_production'
    | 'ready_for_publication'
    | 'publishing'
    | 'browser_required'
    | 'published'
    | 'failed';

type WorkItemLike = { kind: string; state: string };

export interface PublicationGenerationStageInput {
    status: string;
    draftText?: string | null;
    textState?: string | null;
    visualState?: string | null;
    handoffState?: string | null;
    publicationMode?: string | null;
    workItems?: WorkItemLike[];
}

const ACTIVE_WORK_STATES = new Set(['available', 'claimed', 'blocked', 'waiting_approval']);

export function derivePublicationGenerationStage(input: PublicationGenerationStageInput): PublicationGenerationStage {
    if (input.status === 'published') return 'published';
    if (input.status === 'browser_required' || input.publicationMode === 'browser_required') return 'browser_required';
    if (input.status === 'publishing') return 'publishing';
    if (input.status === 'failed') return 'failed';
    if (input.status === 'ready_for_execution' || input.handoffState === 'ready') return 'ready_for_publication';

    const active = (input.workItems || []).filter((item) => ACTIVE_WORK_STATES.has(item.state));
    if (active.some((item) => ['art_direction', 'visual_generate', 'visual_review', 'visual_source_collect'].includes(item.kind))) {
        return 'visual_production';
    }
    if (active.some((item) => item.kind === 'content_review')) return 'content_review';
    if (active.some((item) => item.kind === 'content_write')) return 'writing';
    if (input.draftText?.trim() || input.textState === 'accepted') return 'content_review';
    return 'topic_approval';
}

export function isGeneratedPublicationTask(item: { item_key?: string | null; type?: string | null }) {
    return item.type !== 'week_theme' && Boolean(item.item_key?.startsWith('week-topic:'));
}
