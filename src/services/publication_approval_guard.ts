/** Preparation is not authorization to publish an approval-gated task. */
export function preparationRoute(
    publicationMode: string | null | undefined,
    browserRequired: boolean
): 'preserve_approval' | 'browser_required' | 'connector_auto' {
    if (publicationMode === 'approval_required' || publicationMode === 'owner_released') return 'preserve_approval';
    return browserRequired ? 'browser_required' : 'connector_auto';
}

/** Both scheduler discovery and its atomic claim must use this exact mode. */
export function connectorAutoModeGuard() {
    return { publication_mode: 'connector_auto' as const };
}

/** Re-materialization cannot be used as an owner-release or scheduler opt-in. */
export function assertMaterializationPreservesApproval(currentMode: string | null | undefined, requestedMode: string) {
    if (['approval_required', 'owner_released'].includes(currentMode || '') && currentMode !== requestedMode) {
        throw new Error('[OWNER_RELEASE_REQUIRED] Materialization cannot change an owner-gated publication mode');
    }
}
