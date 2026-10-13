export type Dzen1002ReadReason = 'NAVIGATION_TIMEOUT' | 'RESPONSE_TIMEOUT' | 'READ_TIMEOUT'
    | 'RESPONSE_TOO_LARGE' | 'AUTH_REQUIRED' | 'CHALLENGE_REQUIRED' | 'STUDIO_ROUTE_MISMATCH'
    | 'PAYLOAD_INVALID' | 'REQUEST_FAILED' | 'BODY_READ_FAILED';
export type Dzen1002ObservedResponse = { path: '/editor-api/v3/publications'; status: number;
    state: 'published' | 'draft' | 'other' };

/** Only application-owned enum diagnostics cross the provider error boundary. */
export class Dzen1002ReadFailure extends Error {
    readonly reason: Dzen1002ReadReason;
    constructor(reason: Dzen1002ReadReason, readonly status: number | null = null,
        readonly observedResponses: Dzen1002ObservedResponse[] = []) {
        super('[DZEN1002_READ_FAILED]'); this.reason = reason;
    }
}
