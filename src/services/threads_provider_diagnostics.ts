import type { PublicationDiagnostic } from './publication_diagnostics';
import { ThreadsProviderError } from './threads_provider_error';

const actions = {
    THREADS_PROVIDER_AUTH_REQUIRED: ['The provider rejected the connection credential.', 'Ask the connector administrator to restore the original account connection through secure settings.'],
    THREADS_PROVIDER_PERMISSION_REQUIRED: ['The provider denied permission for this read.', 'Ask the connector administrator to verify the original account and required Threads read permissions.'],
    THREADS_PROVIDER_RATE_LIMITED: ['The provider rate limit prevented this read.', 'Wait for the provider rate limit to recover; do not repeat publication as a connection test.'],
    THREADS_PROVIDER_UNAVAILABLE: ['The provider read service or network is unavailable.', 'Ask the connector administrator to check provider service and network availability.'],
    THREADS_PROVIDER_INVALID_RESPONSE: ['The provider read response could not be decoded.', 'Ask engineering to verify the supported provider response contract and service health.'],
    THREADS_PROVIDER_TIMEOUT: ['The provider read did not complete before cancellation or its time limit.', 'Ask the connector administrator to check provider responsiveness; use only supported read-only verification.'],
    THREADS_PROVIDER_REQUEST_FAILED: ['The provider rejected this read request.', 'Ask the connector administrator to investigate the reported HTTP status through supported provider diagnostics.'],
    THREADS_HISTORY_INCOMPLETE: ['The provider history response did not establish complete pagination.', 'Ask engineering to repair supported provider history pagination before any publication.']
} as const;
type Code=keyof typeof actions;
const supported = new Set(['THREADS_PROVIDER_REQUEST_FAILED','THREADS_PROVIDER_UNAVAILABLE',
    'THREADS_PROVIDER_INVALID_RESPONSE','THREADS_PROVIDER_TIMEOUT','THREADS_HISTORY_INCOMPLETE']);

/** Only typed metadata from the existing identity/history read transport is admitted. */
export function threadsProviderDiagnostic(error:unknown):PublicationDiagnostic|undefined {
    if(!(error instanceof ThreadsProviderError)||!supported.has(error.code))return undefined;
    const operation=error.operation;
    if(operation!=='read_own_posts'&&operation!=='test_connection')return undefined;
    const status=error.status;
    if(status!==undefined&&(!Number.isInteger(status)||status<100||status>599))return undefined;
    let code=error.code as Code;
    if(error.code==='THREADS_PROVIDER_REQUEST_FAILED'){
        if(status===401)code='THREADS_PROVIDER_AUTH_REQUIRED';
        else if(status===403)code='THREADS_PROVIDER_PERMISSION_REQUIRED';
        else if(status===429)code='THREADS_PROVIDER_RATE_LIMITED';
        else if(status!==undefined&&status>=500)code='THREADS_PROVIDER_UNAVAILABLE';
    }
    const [message,correction]=actions[code];
    const stage=operation==='read_own_posts'?'provider_history':'provider_identity';
    return {code,message,reasons:[{code,field:stage,message,
        action:`${correction} Inspect existing attempt and fact history before any further publication request; uncertain outcomes require same-attempt reconciliation, never resend.`}],
        retry_allowed:false,provider:{operation,stage,...(status===undefined?{}:{http_status:status})}};
}
