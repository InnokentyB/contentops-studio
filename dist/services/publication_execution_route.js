"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePublicationExecutionRoute = resolvePublicationExecutionRoute;
exports.browserFallbackReason = browserFallbackReason;
function resolvePublicationExecutionRoute(input) {
    if (input.published)
        return 'published';
    if (!input.contentReady || !input.visualReady || !input.due)
        return 'waiting';
    if (input.publicationMode === 'browser_required')
        return 'browser_required';
    if (input.executionMode === 'manual' || !input.directExecutionSupported)
        return 'browser_required';
    return 'connector_auto';
}
function browserFallbackReason(error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown connector error');
    return {
        code: 'CONNECTOR_PUBLISH_FAILED',
        message,
        retry_via_api: false,
        next_route: 'browser_required'
    };
}
