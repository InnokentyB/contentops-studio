import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hash,type BrowserDependencies} from './browser_publication_contract';
import {createBrowserRecoveryResumePort} from './browser_recovery_resume_repository';
import {resumeBrowserRecovery} from './browser_recovery_resume';
import {preparationRequest,preparationLedger,type PreparationSupervisor,type PreparationRequest} from './browser_preparation_contract';
import {loadPreparation,replacePreparation,preparationSerial} from './browser_preparation_storage';
const acknowledgment=z.object({executorId:z.string().min(1),generation:z.number().int().nonnegative(),challengeSha256:z.string().regex(/^[a-f0-9]{64}$/),oldExecutorQuiescent:z.literal(true),evidenceRef:z.string().regex(/^sha256:[a-f0-9]{64}$/),failureKind:z.enum(['NETWORK_TEMPORARY','EXECUTOR_RESTART'])}).strict();
export async function recoverPreparation(input:unknown,deps:BrowserDependencies,supervisor:PreparationSupervisor,now:()=>number){
 const args=preparationRequest.parse(input),operation=hash(JSON.stringify(args)),challenge=randomUUID();
 const claim=await deps.db.$transaction(async tx=>{
  const loaded=await loadPreparation(tx,deps,args,supervisor.executorId),{ledger,state}=loaded;
  if(state.stage!=='PREPARE'||state.deliveryCertainty!=='NOT_DISPATCHED'||ledger.permitIssued||ledger.dispatchStarted)throw new Error('[POST_SUBMIT_UNKNOWN]');
  if(ledger.operationSha256===operation&&['queued','preparing','quiescent'].includes(ledger.state))return{replay:true,ledger};
  if(ledger.state==='quiescing'&&ledger.operationSha256!==operation)throw new Error('[RECOVERY_IN_PROGRESS]');
  const started=ledger.startedAtMs??now(),deadline=ledger.deadlineMs??started+180000;
  if(ledger.resumptions>=3||now()>=deadline)throw new Error('[RECONCILIATION_BUDGET_EXHAUSTED]');
  if(ledger.startedAtMs!==null&&now()<started+([0,30000,120000][ledger.resumptions]??180000))throw new Error('[RECOVERY_IN_PROGRESS]');
  if(await tx.workflowEvent.count({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,command:'ba_pre_submit_browser_submission'}}))throw new Error('[POST_SUBMIT_UNKNOWN]');
  const next={...ledger,state:'quiescing' as const,startedAtMs:started,deadlineMs:deadline,resumptions:ledger.resumptions+1,operationSha256:operation,challengeSha256:hash(challenge),proofSha256:null,outbox:'none' as const};
  await replacePreparation(tx,loaded.stored,next);
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,command:'browser_preparation_quiesce_requested',after_state:{attempt_id:args.attemptId,generation:ledger.generation,round:next.resumptions,submission_permitted:false}}});
  return{replay:false,ledger:next};
 },preparationSerial);
 if(!claim.replay){
  const controller=new AbortController(),deadline=Math.min(claim.ledger.deadlineMs!,now()+10000);
  let timer:NodeJS.Timeout|undefined;
  try{
   const raw=await Promise.race([supervisor.quiesce({projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,generation:claim.ledger.generation,challenge,deadlineMs:deadline,signal:controller.signal}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]'));},Math.max(1,deadline-now()));})]);
   const proof=acknowledgment.safeParse(raw);
   if(!proof.success||controller.signal.aborted||now()>=deadline||proof.data.executorId!==supervisor.executorId||proof.data.generation!==claim.ledger.generation||proof.data.challengeSha256!==hash(challenge))throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
   await deps.db.$transaction(async tx=>{
    const loaded=await loadPreparation(tx,deps,args,supervisor.executorId),{ledger,state}=loaded;
    if(ledger.state!=='quiescing'||ledger.generation!==claim.ledger.generation||ledger.operationSha256!==operation||ledger.challengeSha256!==proof.data.challengeSha256||ledger.deadlineMs===null||now()>=ledger.deadlineMs||state.stage!=='PREPARE')throw new Error('[RECOVERY_CONFLICT]');
    await supervisor.beforeQuiescenceCommit?.(tx,{...args,generation:ledger.generation,challengeSha256:proof.data.challengeSha256});
    await replacePreparation(tx,loaded.stored,{...ledger,state:'quiescent',proofSha256:proof.data.evidenceRef.slice(7)});
    await tx.deliveryAttempt.updateMany({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,status:'pending',error_message:null},data:{error_message:proof.data.failureKind,requires_manual_confirmation:true}});
    await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,command:'browser_preparation_quiescent',after_state:{attempt_id:args.attemptId,generation:ledger.generation,evidence_sha256:proof.data.evidenceRef.slice(7),cause_code:proof.data.failureKind}}});
   },preparationSerial);
  }finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 const fence={executorId:supervisor.executorId,proveQuiescence:async(tx:Parameters<NonNullable<Parameters<typeof createBrowserRecoveryResumePort>[1]>['proveQuiescence']>[0],state:Parameters<NonNullable<Parameters<typeof createBrowserRecoveryResumePort>[1]>['proveQuiescence']>[1])=>{
  // Read proof from the durable repository transaction, never a caller flag or process-local acknowledgement.
  const proof=await tx.preparationProof?.(args,supervisor.executorId);
  if(!proof||proof.state!=='quiescent'||proof.generation!==state.executionGeneration||proof.operationSha256!==operation||!proof.proofSha256||!proof.deadlineMs||now()>=proof.deadlineMs)return null;
  return{executorId:supervisor.executorId,evidenceRef:`sha256:${proof.proofSha256}`,issuedPermitCount:0 as const,dispatchCount:0 as const,oldExecutorQuiescent:true as const,challengeSupersessionSupported:true as const,resumeDeadlineMs:proof.deadlineMs};
 }};
 const port=createBrowserRecoveryResumePort(deps,fence,async(tx,value)=>{
  const stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
  const ledger=preparationLedger.parse(stored?.ledger);
  if(!stored||ledger.state!=='quiescent'||ledger.generation!==value.expectedGeneration||ledger.operationSha256!==operation||ledger.proofSha256!==value.evidenceRef.slice(7)||ledger.deadlineMs===null||value.leaseExpiresAt.getTime()>ledger.deadlineMs)throw new Error('[RECOVERY_CONFLICT]');
  await replacePreparation(tx,stored,{...ledger,generation:value.nextGeneration,state:'queued',outbox:'pending'});
 });
 return resumeBrowserRecovery(args,port);
}
