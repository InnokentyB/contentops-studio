/** Preparation is not authorization to publish an approval-gated task. */
export function preparationRoute(
    publicationMode: string | null | undefined,
    browserRequired: boolean
): 'preserve_approval' | 'browser_required' | 'connector_auto' {
    if (publicationMode === 'approval_required') return 'preserve_approval';
    return browserRequired ? 'browser_required' : 'connector_auto';
}

/** Both scheduler discovery and its atomic claim must use this exact mode. */
export function connectorAutoModeGuard() {
    return { publication_mode: 'connector_auto' as const };
}
