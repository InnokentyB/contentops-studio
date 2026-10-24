import type {PublicationDiagnostic} from './publication_diagnostics';

const reasons={
 BROWSER_ATTEMPT_SCOPE_MISMATCH:['delivery_attempt.scope','The requested attempt was not found in the exact project, task and channel.','Inspect the original scoped start receipt. Do not substitute another attempt or create a replacement.'],
 BROWSER_ATTEMPT_KEY_MISMATCH:['delivery_attempt.idempotency_key','The supplied key differs from the immutable key recorded at the original start.','Use the original start key for this same attempt; do not generate a pre-submit operation key. Recheck the current lease and package first. An expired lease requires supported fenced recovery of the same attempt; correcting the key does not renew it or grant Submit.'],
 BROWSER_ATTEMPT_NOT_PENDING:['delivery_attempt.status','The original attempt is no longer pending.','Inspect its current result and reconcile through the owning executor. Do not reset its state or create another attempt.'],
 BROWSER_ATTEMPT_HISTORY_CONFLICT:['delivery_attempt.history','The attempt is outside the authorized history boundary or is not the only current attempt.','Inspect the audited owner instruction and existing attempt history. Preserve all attempts and reconcile conflicting or uncertain outcomes; do not bypass them with another key.']
} as const;
export type BrowserAttemptFailure=keyof typeof reasons;
/** Static allowlisted reasons only; request values and original keys never enter errors or logs. */
export class BrowserAttemptDiagnosticError extends Error {
 constructor(readonly failures:readonly BrowserAttemptFailure[]){super('[BROWSER_RECONCILIATION_REQUIRED]');}
}
export function browserAttemptDiagnostic(error:unknown):PublicationDiagnostic|undefined {
 if(!(error instanceof BrowserAttemptDiagnosticError))return undefined;
 return {code:'BROWSER_RECONCILIATION_REQUIRED',message:'The existing attempt did not satisfy the browser lifecycle checks.',retry_allowed:false,
  reasons:error.failures.map(code=>{const [field,message,action]=reasons[code];return {code,field,message,action};})};
}
