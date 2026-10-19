import {recoveryOutcome} from './browser_recovery_coordinator';
import type {RecoveryOutcome} from './browser_recovery_contract';
/** Existing executors without controlled no-dispatch evidence stay UNKNOWN, even on a preparation error. */
export function assessLegacyBrowserRecovery(reason?:string):RecoveryOutcome {
 if(reason==='PRE_SUBMIT_REJECTED'||reason==='BROWSER_UNAVAILABLE')return {code:'PRE_DISPATCH_PROOF_UNAVAILABLE',causeCode:'PRE_DISPATCH_PROOF_UNAVAILABLE',stage:'PREPARE',deliveryCertainty:'UNKNOWN',recoveryAction:'CONTACT_ENGINEERING',message:'The preparation failed, but this executor has not proved that submission was impossible.',action:'Ask engineering to establish controlled pre-permit evidence and executor fencing. Preserve this attempt; do not clear its error or resend.',retry_allowed:false,submission_permitted:false};
 return recoveryOutcome('READBACK_CAPABILITY_UNAVAILABLE');
}
/** Reconstruct only static approved fields, never serialize arbitrary adapter extras. */
export function projectBrowserRecovery(value:unknown):RecoveryOutcome|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const code=(value as Record<string,unknown>).code;
 if(code==='LEASE_EXPIRED_PRE_DISPATCH'||code==='RECOVERY_PREPARE_RESUMED')return {code:'RECOVERY_PREPARE_RESUMED',causeCode:'PREPARE_FAILED',stage:'PREPARE',deliveryCertainty:'NOT_DISPATCHED',recoveryAction:'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR',message:'The same pre-permit attempt is waiting for its registered fenced executor to continue preparation.',action:'The registered executor must pick up the current generation and lease, recheck the unchanged approved package and pass the normal pre-submit checks. No submission permission is granted by this status.',retry_allowed:false,submission_permitted:false};
 if(code==='PRE_DISPATCH_PROOF_UNAVAILABLE')return assessLegacyBrowserRecovery('PRE_SUBMIT_REJECTED');
 return recoveryOutcome(typeof code==='string'?code:'RECOVERY_CONFLICT');
}
