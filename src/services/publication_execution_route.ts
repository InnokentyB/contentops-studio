import { vkPublicationAdapterRequired, isVkPublicationPlatform, isDzenPublicationPlatform, dzenPublicationAdapterRequired } from './vk_publication_route_contract';
export type PublicationExecutionRoute = 'waiting' | 'connector_auto' | 'browser_required' | 'vk_adapter_required' | 'published';

export interface PublicationExecutionRouteInput {
    platform?: string | null;
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
    if (input.publicationMode === 'approval_required' || input.publicationMode === 'owner_released') return 'waiting';
    if (isVkPublicationPlatform(input.platform)) return 'vk_adapter_required';
    if (input.publicationMode === 'browser_required') return 'browser_required';
    // A task can originate from a human-review action and still be approved for
    // connector execution once the current revision has passed its review gate.
    if (input.publicationMode === 'connector_auto' && input.directExecutionSupported) return 'connector_auto';
    if (input.executionMode === 'manual' || !input.directExecutionSupported) return 'browser_required';
    return 'connector_auto';
}

export function browserFallbackReason(error: unknown, platform?: string | null) {
    if (isVkPublicationPlatform(platform)) return vkPublicationAdapterRequired();
    if (isDzenPublicationPlatform(platform)) return dzenPublicationAdapterRequired();
    const message = error instanceof Error ? error.message : String(error || 'Unknown connector error');
    return {
        code: 'CONNECTOR_PUBLISH_FAILED',
        message,
        retry_via_api: false,
        next_route: 'browser_required' as const
    };
}

/** Handoff requirement only: no registry readiness, execution permission or publication fact is inferred. */
export function vkAdapterPublicationHandoff(status: unknown) {
    return { success: false, skipped: true, blocked: true, provider_execution: 'blocked' as const, status: typeof status === 'string' ? status : null,
        reason: 'vk_adapter_required', adapter_requirement: vkPublicationAdapterRequired() };
}

export function dzenAdapterPublicationHandoff(status: unknown) {
    return { success: false, skipped: true, blocked: true, provider_execution: 'blocked' as const,
        status: typeof status === 'string' ? status : null,
        reason: 'dzen_adapter_required', adapter_requirement: dzenPublicationAdapterRequired() };
}

export { isVkPublicationPlatform } from './vk_publication_route_contract';
