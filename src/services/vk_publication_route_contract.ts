/** Operating route identity only; this is not permission, adapter health or provider evidence. */
export const VK_PUBLICATION_ROUTE = 'planner_registered_independent_adapter' as const;
export const VK_PUBLICATION_BOOTSTRAP_RULE = 'VK owned publication: use ONLY documented Planner commands -> registered independent adapter. Never use Codex CUA/cua.getTab/ComputerUse, personal browser tabs, CDP or session injection, including preflight and UAT. Adapter unavailable or failed -> BLOCKED and repair, never fallback. Explicit action/site denial remains blocked; UNKNOWN/started/uncertain never retry. Human operator context is separate; receipt is not a publication fact. Contract: docs/operations/vk-owned-publication-route.md';
export function assertVkPublicationRoute(route: unknown): asserts route is typeof VK_PUBLICATION_ROUTE {
    if (route !== VK_PUBLICATION_ROUTE) throw new Error('[VK_PUBLICATION_WRONG_ROUTE]');
}
/** A fixed blocked result cannot leak a provider exception or invite a different browser/API route. */
export function vkPublicationAdapterRequired() {
    return { code: 'VK_INDEPENDENT_ADAPTER_REQUIRED' as const,
        message: 'Use the documented Planner command and registered independent VK adapter. If unavailable, keep BLOCKED and repair the adapter. Codex browser and alternate-route fallback are forbidden.',
        retry_via_api: false as const, next_route: 'vk_adapter_required' as const, required_route: VK_PUBLICATION_ROUTE };
}

/** Task-owned API entrypoints must stop before claims, credential refresh or provider calls. */
export function rejectVkDirectPublication(): void {
    const requirement = vkPublicationAdapterRequired();
    throw new Error(`[${requirement.code}] ${requirement.message}`);
}

export function isVkPublicationPlatform(platform: unknown): boolean {
    return typeof platform === 'string' && platform.trim().toLowerCase() === 'vk';
}
