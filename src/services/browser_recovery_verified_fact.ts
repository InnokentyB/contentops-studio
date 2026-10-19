import {z} from 'zod';
import publicationFactService,{type RecordPublicationFactArgs} from './publication_fact.service';
import {browserBoundarySchema,checkedBrowserRelease,checkedBrowserAttempt} from './browser_publication_guard';
import {browserDefaults,hash,snapshotHash,type BrowserDependencies} from './browser_publication_contract';
import {withBrowserRecoveryFinalization,assertBrowserRecoveryCommit} from './browser_recovery_guard';
import type {RecoveryReservation,VerifiedRecoveryEvidence} from './browser_recovery_contract';
const inputSchema=browserBoundarySchema.safeExtend({attemptId:z.number().int().positive()});
type FactWriter=(args:RecordPublicationFactArgs)=>Promise<unknown>;
/** Internal provider-verified finalization: never fabricates screenshot, browser observations or duplicate-absence claims. */
export async function finalizeVerifiedBrowserRecovery(input:unknown,r:RecoveryReservation,e:VerifiedRecoveryEvidence,signal:AbortSignal,deps:BrowserDependencies=browserDefaults,write:FactWriter=args=>publicationFactService.record(args)):Promise<'finalized'> {
 const args=inputSchema.parse(input),s=args.snapshot;
 if(signal.aborted||s.identity.platform!=='linkedin'||e.provider!=='linkedin'||args.projectId!==r.scope.projectId||args.taskId!==r.scope.taskId||args.attemptId!==r.scope.attemptId||snapshotHash(s)!==r.scope.packageSha256||e.packageSha256!==r.scope.packageSha256||e.accountSha256!==hash(JSON.stringify(s.identity))||e.bodySha256!==s.bodySha256||e.assetSha256!==s.assetSha256||!/^urn:li:(share|ugcPost):[1-9]\d*$/.test(e.providerObjectId)||e.publicUrl!==`https://www.linkedin.com/feed/update/${e.providerObjectId}/`||!/^sha256:[a-f0-9]{64}$/.test(e.evidenceRef))throw new Error('[RECOVERY_SCOPE_MISMATCH]');
 await write({projectId:args.projectId,taskId:args.taskId,actorId:args.actorId,artifactKind:'post',outcome:'published',browserWorkItemId:args.workItemId,publicUrl:e.publicUrl,providerObjectId:e.providerObjectId,publishedAt:new Date(e.publishedAtMs).toISOString(),confirmationMode:'reconciled',evidence:{type:'api',ref:e.evidenceRef},utmStatus:'not_applicable',beforeCommit:tx=>assertBrowserRecoveryCommit(tx,r,args.actorId,signal),beforeWrite:tx=>withBrowserRecoveryFinalization(tx,r,args.actorId,signal,async()=>{
  const {task}=await checkedBrowserRelease(tx,args,deps);const attempt=await checkedBrowserAttempt(tx,args);
  const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
  if(!row?.lookup_window_start_at||!row.lookup_window_end_at||e.publishedAtMs<row.lookup_window_start_at.getTime()||e.publishedAtMs>row.lookup_window_end_at.getTime()||task.status!=='publishing'||!attempt.error_message||hash(task.draft_text||'')!==e.bodySha256||signal.aborted)throw new Error('[RECOVERY_SCOPE_MISMATCH]');
  const changed=await tx.deliveryAttempt.updateMany({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,channel_id:s.channelId,idempotency_key:args.idempotencyKey,status:'pending'},data:{status:'delivered',actual_published_at:new Date(e.publishedAtMs),requires_manual_confirmation:false,error_message:null}});
  if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,actor_id:args.actorId,command:'browser_recovery_provider_verified',after_state:{attempt_id:args.attemptId,provider:'linkedin',evidence_sha256:e.evidenceRef.slice(7),submission_permitted:false,retry_allowed:false}}});
 })});
 return 'finalized';
}
