/** Actual tool provenance; this is neither an external clearance service nor a provider response. */
export const DZEN1002_RESTRICTION = Object.freeze({
    source: 'browser_use_tool_result',
    sourceCall: 'call_34840360c84440a286f2230a22165d96',
    observedAt: '2026-10-11T21:17:42.380Z',
    blockedOutcomeUrl: 'https://dzen.ru/a/asvdioZFzXeQEO5O',
    blockedOutcome: 'open_published_task1045_article',
    task1002Applicability: 'unresolved'
} as const);
export type Dzen1002Action = 'inventory' | 'publish' | 'readback';
/** No request/config/callback can grant permission or test around the recorded refusal. */
export function requireDzen1002Action(operation: Dzen1002Action): void {
    if (!['inventory', 'publish', 'readback'].includes(operation)) throw new Error('[DZEN1002_ACTION_INVALID]');
    throw new Error(`[DZEN1002_ACTION_SCOPE_UNRESOLVED] Local applicability to ${operation} is unresolved; recorded refusal concerns opening task1045 article. No native action attempted.`);
}
