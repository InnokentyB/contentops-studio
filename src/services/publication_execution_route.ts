export type PublicationExecutionRoute = 'waiting' | 'connector_auto' | 'browser_required' | 'published';

export interface PublicationExecutionRouteInput {
    contentReady: boolean;
    visualReady: boolean;
    due: boolean;
    published: boolean;
    executionMode: 'manual' | 'automated';
    directExecutionSupported: boolean;
    publicationMode?: string | null;
}

export function resolvePublicationExecutionRoute(input: PublicationExecutionRouteInput): PublicationExecutionRoute {
    if (input.published) return 'published';
    if (!input.contentReady || !input.visualReady || !input.due) return 'waiting';
    if (input.publicationMode === 'browser_required') return 'browser_required';
    if (input.executionMode === 'manual' || !input.directExecutionSupported) return 'browser_required';
    return 'connector_auto';
}

export function browserFallbackReason(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown connector error');
    return {
        code: 'CONNECTOR_PUBLISH_FAILED',
        message,
        retry_via_api: false,
        next_route: 'browser_required' as const
    };
}
