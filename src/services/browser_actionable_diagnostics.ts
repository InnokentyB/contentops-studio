import {ownerManualPreservationDiagnostic} from './owner_manual_publication_diagnostics';
import {projectBrowserRecovery} from './browser_recovery_assessment';
import {isPublicationStorageConflict} from './publication_storage_conflict';
import type { PublicationDiagnostic } from './publication_diagnostics';

type Entry=readonly [string,string,string];
const catalog:Record<string,Entry>={
 BROWSER_REQUEST_INVALID:['request','The request does not satisfy the browser lifecycle input contract.','Read this tool input schema and correct missing or invalid fields. Use the current scoped snapshot; never paste credentials or fabricate release/lease proof.'],
 OWNER_REQUIRED:['actor','This operation requires a project owner.','Ask an authenticated project owner to perform the scoped operation.'],
 PUBLICATION_TASK_NOT_FOUND:['task','No task was found in the authorized project.','Read the current project task list and select the intended task without broadening permissions.'],
 STALE_MANIFEST:['manifest','The workspace manifest has changed.','Read the current workspace manifest and review the package before requesting a new release.'],
 IDEMPOTENCY_CONFLICT:['idempotency_key','This key belongs to different operation inputs.','Read the original operation and its attempt history. Do not replace the key to bypass an existing attempt.'],
 BROWSER_SNAPSHOT_MISMATCH:['snapshot','The requested snapshot differs from the current package.','Inspect the current package and review each changed field before requesting a matching owner release.'],
 BROWSER_RECONCILIATION_REQUIRED:['delivery_attempt','Existing delivery state requires reconciliation.','Read the existing attempt, work item and publication fact. Reconcile the provider outcome through the registered route; do not submit again or create a replacement key.'],
 BROWSER_REQUEST_FAILED:['operation','The operation failed; the exact cause is not classified.','Ask engineering to investigate safe diagnostics. Inspect existing attempts and reconcile uncertain outcomes before further execution.']
};
const add=(codes:string[],entry:Entry):void=>{for(const code of codes)catalog[code]=entry;};
add(['PUBLICATION_VISUAL_REVIEW_REQUIRED'],['visual_review','The current Owner visual requirement has no matching approved independent review.','Read the current art-direction context, complete its source/generation and separate visual review, then obtain a release for that exact package. Restoring old no-visual fields does not satisfy the requirement.']);
add(['BROWSER_IDENTITY_INVALID','PROVIDER_IDENTITY_INVALID','BROWSER_IDENTITY_BINDING_CONFLICT'],['identity','The supplied identity failed the approved identity checks.','Inspect the channel Registry binding and canonical provider identity. Correct it through the owner metadata workflow; do not substitute another account.']);
add(['BROWSER_NOT_RELEASE_READY','BROWSER_NOT_CLAIMABLE','BROWSER_NOT_STARTED'],['lifecycle','The task is not in the state required for this operation.','Inspect task status and existing work/attempt history. Use the documented transition for the current state; reconcile any started attempt first.']);
add(['BROWSER_METADATA_REPAIR_REQUIRED','BROWSER_HANDOFF_METADATA_INVALID'],['metadata','The publication metadata does not meet the release prerequisites.','Preview owner metadata repair against the exact accepted package. Resolve partial or divergent handoff metadata before applying a reviewed repair.']);
add(['BROWSER_AUDITED_IDENTITY_REQUIRED','BROWSER_RELEASE_AUDIT_REQUIRED','BROWSER_RELEASE_PROOF_INVALID'],['release','The required matching audited release or identity proof was not established.','Inspect owner metadata audit and release history for the current package. Ask the owner to resolve the missing or invalid proof through the normal release workflow; do not fabricate proof.']);
add(['BROWSER_ACTIVE_LEASE_REQUIRED','BROWSER_WORK_ALREADY_CLAIMED','BROWSER_WORK_EXISTS'],['work_item','The required exclusive work item or active executor lease is unavailable.','Inspect the existing work item, lease and attempts. Coordinate with its executor; reconcile any started attempt before considering another claim.']);
add(['BROWSER_ATTEMPT_SCOPE_MISMATCH','BROWSER_FACT_RECONCILIATION_REQUIRED'],catalog.BROWSER_RECONCILIATION_REQUIRED!);
add(['BROWSER_OBSERVATION_MISMATCH'],['observation','The observed provider composition does not match the accepted package.','Compare the approved identity, paragraph order, text and image using the registered executor. Do not submit until observations match; reconcile any uncertain submission first.']);
add(['BROWSER_PRE_SUBMIT_REQUIRED','BROWSER_SUBMISSION_OUTSIDE_PERMIT'],['submission_permit','The required matching unexpired submission permission was not established.','Inspect the existing attempt and permit audit. Reconcile the provider outcome; do not replay or renew a consumed or lost permit to submit again.']);
add(['BROWSER_PUBLICATION_TIME_MISMATCH'],['published_at','Provider publication time does not satisfy the confirmation checks.','Read back the existing provider object and verify its actual publication time before reconciling that same attempt.']);
add(['BROWSER_RECONCILIATION_NOT_REQUIRED'],['delivery_attempt','The current attempt does not meet reconciliation prerequisites.','Inspect the current attempt and publication fact and use the documented confirmation or read-only route. Do not create a duplicate attempt.']);
add(['BROWSER_NATIVE_RECEIPT_REQUIRED','BROWSER_NATIVE_POLICY_MISMATCH'],['native_admission','The registered native execution admission requirements were not met.','Use the registered independent adapter and inspect its admission status. Repair that adapter if unavailable; no browser/session or manual bypass is permitted.']);
add(['BROWSER_METADATA_CAS_CONFLICT','BROWSER_RELEASE_CAS_CONFLICT','BROWSER_START_CAS_CONFLICT','BROWSER_UNCERTAIN_CAS_CONFLICT','BROWSER_CONFIRM_CAS_CONFLICT'],['lifecycle','The persisted state changed before this operation could be recorded.','Read current task, work item, attempt and audit state. Review the change and reconcile any started or uncertain attempt before another operation.']);
add(['RECOVERY_SCOPE_MISMATCH','RECOVERY_CONFLICT','RECOVERY_CANCELLED'],['recovery','Recovery could not safely change the current scoped attempt.','Read the persisted recovery status and canonical fact. Resolve the reported scope or concurrent change through engineering; do not clear errors, replace keys or resend.']);
add(['BROWSER_RECOVERY_STORAGE_UNAVAILABLE'],['recovery','Recovery storage is not ready for the configured runtime.','Ask engineering to apply the reviewed additive migration before enabling recovery admission. Preserve current attempts; do not retry publication.']);
add(['BROWSER_RECOVERY_V2_HELD'],['recovery','This attempt is held by the versioned recovery lifecycle.','Read the recovery status and use its admitted read-only recovery route. Do not use v1 controls to clear errors, issue another permit or resend.']);
add(['OWNER_INSTRUCTION_REQUIRED','PUBLICATION_PRINCIPAL_REQUIRED'],['authorization','An authenticated Owner command is required to authorize an additional publication.','Use the Owner profile to issue the explicit command for this exact package; Publisher consumes an existing instruction.']);
add(['OWNER_INSTRUCTION_INVALID','OWNER_INSTRUCTION_SCOPE_MISMATCH'],['authorization','The Owner instruction does not match the current publication work or package.','Use the work item returned by the exact Owner command. Preserve previous attempts and do not substitute an old work item.']);
add(['OWNER_NEW_PUBLICATION_INSTANCE_REQUIRED'],['publication','This task already has a canonical publication fact.','Create a separate publication instance for the requested additional post, preserving the existing fact.']);
add(['OWNER_INSTRUCTION_HISTORY_LIMIT'],['history','The publication history exceeds the bounded command lookup.','Ask engineering to add bounded pagination; preserve the existing history.']);
const fields=new Set(('task.exists project_id id channel_id channel.id channel.project_id channel.is_active channel.type channel.config.account_type channel.config.account_ref channel.config.profile_url channel.config.execution_modes.manual channel.config.capability_flags.manual_handoff content_revision accepted_revision text_state draft_text.sha256 schedule_at publish_at handoff_state quality_report.publication_hold visual_state visual_placement selected_asset_id selected_asset.id selected_asset.project_id selected_asset.content_item_id selected_asset.content_revision selected_asset.decision_id selected_asset.absent snapshot.selected_asset_id snapshot.asset_sha256 visual_mode.not_required draft_text.native_length selected_asset.placement selected_asset.status selected_asset.file_url.https selected_asset.storage.sha256 selected_asset.storage.managed selected_asset.storage.provider selected_asset.storage.mime_type visual_decision_version decision.id decision.project_id decision.content_item_id decision.source_content_revision decision.decision_version decision.status decision.decision decision.channel decision.placement quality_report.handoff_bundle.publication.body').split(' '));
function diagnostic(code:string):PublicationDiagnostic {
 const [field,message,action]=catalog[code]!;
 return {code,message,reasons:[{code,field,message,action}],retry_allowed:false};
}
/** Accept only known codes/field names. Never expose or log raw values from an exception. */
export function browserErrorDiagnostic(error:unknown):PublicationDiagnostic {
    const manual = ownerManualPreservationDiagnostic(error);
    if (manual) return manual;
 if(isPublicationStorageConflict(error)){
  const code='BROWSER_STATE_CONFLICT',message='The publication state changed concurrently; this operation was not committed.';
  return {code,message,retry_allowed:false,reasons:[{code,field:'lifecycle',message,
   action:'Refresh the current task, work item and audit state. Inspect and reconcile any existing or uncertain delivery before another operation; never resend based on this conflict.'}]};
 }
 if(error instanceof Error&&error.name==='ZodError')return diagnostic('BROWSER_REQUEST_INVALID');
 const message=error instanceof Error?error.message:'';
 const candidate=/^\[([A-Z_]+)\]/.exec(message)?.[1];
 const code=candidate&&Object.prototype.hasOwnProperty.call(catalog,candidate)?candidate:'BROWSER_REQUEST_FAILED';
 const result=diagnostic(code);
 if(code!=='BROWSER_SNAPSHOT_MISMATCH')return result;
 let rows:unknown;
 try{rows=JSON.parse(message.slice('[BROWSER_SNAPSHOT_MISMATCH]'.length));}
 catch{return result;}
 if(!Array.isArray(rows))return result;
 const safeFields=[...new Set(rows.flatMap((row:unknown)=>{
  if(!row||typeof row!=='object')return [];
  const field=(row as Record<string,unknown>).field;
  return typeof field==='string'&&fields.has(field)?[field]:[];
 }))];
 if(!safeFields.length)return result;
 return {...result,reasons:safeFields.map(field=>({code:'BROWSER_SNAPSHOT_FIELD_MISMATCH',field,
  message:`The current package does not match the approved snapshot field: ${field}.`,
  action:'Read the current value through scoped inspection, resolve this field through its normal review workflow, then request an owner release matching the accepted package. Do not overwrite delivery history.'}))};
}
export function browserResultDiagnostic(result:Record<string,unknown>):PublicationDiagnostic|undefined {
 const recovery=projectBrowserRecovery(result.recovery);
 if(recovery&&recovery.code!=='RECONCILIATION_FOUND')return {code:recovery.code,message:recovery.message,retry_allowed:false,reasons:[{code:recovery.code,field:'recovery',message:recovery.message,action:recovery.action}]};
 const check=result.snapshot_check;
 if(check&&typeof check==='object'&&!Array.isArray(check)){
  const snapshot=check as Record<string,unknown>;
  if(snapshot.valid===false&&Array.isArray(snapshot.mismatches)){
   const rows=snapshot.mismatches.map((row:unknown)=>({field:row&&typeof row==='object'?(row as Record<string,unknown>).field:undefined}));
   return browserErrorDiagnostic(new Error('[BROWSER_SNAPSHOT_MISMATCH] '+JSON.stringify(rows)));
  }
 }
 if(result.state==='reconciliation_required'||result.next_action==='reconcile_existing_attempt'
  ||(result.replayed===true&&result.submission_permitted===false))return diagnostic('BROWSER_RECONCILIATION_REQUIRED');
 return undefined;
}
/** Preserve established lifecycle metadata; diagnostics contain only reviewed static fields. */
export function browserResultProjection(result:Record<string,unknown>): {payload:Record<string,unknown>;diagnostic?:PublicationDiagnostic;isError?:boolean} {
 const detail=browserResultDiagnostic(result);
 if(!detail)return {payload:result};
 const allowed=['state','status','attempt_id','work_item_id','submission_permitted','retry_allowed','replayed','mutates_state','next_action'];
 const payload:Record<string,unknown>={};
 const recovery=projectBrowserRecovery(result.recovery);
 if(recovery)payload.recovery=recovery;
 if(result.mutates_state===false)return {payload:result,diagnostic:detail,isError:false};
 for(const key of allowed)if(Object.prototype.hasOwnProperty.call(result,key))payload[key]=result[key];
 return {payload,diagnostic:detail,isError:false};
}
