/** V2 subordinate recovery contracts; application registration is capability admission, never caller data. */
export type RecoveryScope={projectId:number;taskId:number;attemptId:number;packageSha256:string};
export type RecoveryStage='PREPARE'|'PERMIT_ISSUED'|'DISPATCH_STARTED'|'AWAITING_RESULT'|'RECONCILING'|'FINALIZED';
export type DeliveryCertainty='NOT_DISPATCHED'|'POSSIBLY_SENT'|'CONFIRMED_SENT'|'PROVEN_NOT_SENT'|'UNKNOWN';
export type RecoveryAction='CONTINUE_SAME_ATTEMPT_AFTER_REPAIR'|'WAIT_SYSTEM_RETRY'|'READ_ONLY_RECONCILIATION'|'INSPECT_CONFIRMED_FACT'|'CONTACT_ENGINEERING'|'RESTORE_PERMISSION'|'REVIEW_APPROVAL'|'REVIEW_PACKAGE'|'RESOLVE_AMBIGUITY'|'NONE';
export type RecoveryOutcome={code:string;stage:RecoveryStage;deliveryCertainty:DeliveryCertainty;causeCode:string;recoveryAction:RecoveryAction;message:string;action:string;retry_allowed:false;submission_permitted:false};
export type RecoveryReservation={scope:RecoveryScope;rowVersion:number;executionGeneration:number;leaseToken:string;startedAtMs:number;deadlineMs:number;round:number;requestsUsed:number};
export type RecoveryReservationResult={kind:'reserved';reservation:RecoveryReservation}|{kind:'held'|'exhausted'|'finalized'|'legacy';outcome?:RecoveryOutcome};
/** Every method compares scope, generation, version and secret lease; budgets never reset on replay. */
export interface BrowserRecoveryRepository {
 reserve(scope:RecoveryScope,nowMs:number):Promise<RecoveryReservationResult>;
 takeRequest(reservation:RecoveryReservation,nowMs:number):Promise<boolean>;
 settle(reservation:RecoveryReservation,outcome:RecoveryOutcome,nowMs:number):Promise<'committed'|'conflict'>;
}
export type RecoveryContext={scope:RecoveryScope;provider:string;accountSha256:string;bodySha256:string;assetSha256:string|null;publishedAfterMs:number;publishedBeforeMs:number;knownObjectId?:string};
/** Evidence stays internal/protected. No body, credential or provider payload belongs here. */
export type VerifiedRecoveryEvidence={schemaVersion:1;provider:string;accountSha256:string;packageSha256:string;bodySha256:string;assetSha256:string|null;providerObjectId:string;publicUrl:string;publishedAtMs:number;observedAtMs:number;evidenceRef:string};
export type RecoveryReadControl={signal:AbortSignal;deadlineMs:number;maxRequests:number;takeRequest:()=>Promise<boolean>};
/** Must honor abort/deadline and obtain one durable request permit before EVERY provider request/page. */
export interface BrowserRecoveryPort {
 timeoutMs:number;
 read(context:RecoveryContext,control:RecoveryReadControl):Promise<unknown>;
 verify(context:RecoveryContext,candidate:unknown,control:RecoveryReadControl):Promise<unknown>;
}
export type BrowserRecoveryPorts=Map<string,BrowserRecoveryPort>;
export interface RecoveryClock {
 now():number;
 wait(ms:number,signal:AbortSignal):Promise<void>;
 timer(ms:number,callback:()=>void):()=>void;
}
export type RecoveryFinalizer=(reservation:RecoveryReservation,evidence:VerifiedRecoveryEvidence,outcome:RecoveryOutcome,signal:AbortSignal)=>Promise<'finalized'|'conflict'|'approval_revoked'|'package_changed'|'permission_denied'>;
export type BrowserRecoveryDependencies={repository:BrowserRecoveryRepository;ports:BrowserRecoveryPorts;clock:RecoveryClock;finalize:RecoveryFinalizer;signal?:AbortSignal};
export const RECOVERY_LIMITS={rounds:3,requests:20,deadlineMs:180000,roundOffsetsMs:[0,30000,120000] as readonly number[]};
