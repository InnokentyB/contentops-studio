export type PublicationContentState = 'empty' | 'ready' | 'published';

function hasText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
}

export function derivePublicationContentState(item: any): PublicationContentState {
    if (String(item?.status || '') === 'published' || hasText(item?.published_link)) {
        return 'published';
    }

    const handoffBody = item?.quality_report?.handoff_bundle?.publication?.body;
    if (hasText(item?.draft_text) || hasText(handoffBody)) {
        return 'ready';
    }

    return 'empty';
}
