/** Provider error metadata only; raw responses, credentials and transport errors are never retained. */
export class ThreadsProviderError extends Error {
    constructor(public readonly code:string,public readonly operation:string,public readonly status?:number){
        super(`Threads provider request failed (${operation}${status?`, HTTP ${status}`:''})`);
        this.name='ThreadsProviderError';
    }
}
