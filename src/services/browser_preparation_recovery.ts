import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {browserDefaults,hash,snapshotHash,type BrowserDependencies} from './browser_publication_contract';
import {browserBoundarySchema,browserObservedSchema,assertBrowserLease} from './browser_publication_guard';
import {startBrowserSubmission,preSubmitBrowserSubmission,browserUncertainSchema} from './browser_publication_execution';
import {browserReconcileSchema,finalizeBrowserRecoverySubmission} from './browser_publication_confirmation';
import {createBrowserRecoveryRepository} from './browser_recovery_repository';
import {withBrowserPreparationPermit} from './browser_recovery_guard';
import {assessLegacyBrowserRecovery,projectBrowserRecovery} from './browser_recovery_assessment';
import {recoveryOutcome} from './browser_recovery_coordinator';
import {recoverPreparation} from './browser_preparation_resume';
import {admitPreparation,loadPreparation,replacePreparation,preparationSerial} from './browser_preparation_storage';
import {preparationRequest,preparationPickup,type PreparationSupervisor,type PreparationRequest} from './browser_preparation_contract';
import type {BrowserRecoveryOperation} from './browser_recovery_runtime';
type Options={deps?:BrowserDependencies;supervisor?:PreparationSupervisor;now?:()=>number};
function outcome(error:unknown):Record<string,unknown>{
 const code=error instanceof Error?/^\[([A-Z_]+)\]/.exec(error.message)?.[1]:undefined;
 if(code==='PRE_DISPATCH_PROOF_UNAVAILABLE')return {...assessLegacyBrowserRecovery('BROWSER_UNAVAILABLE'),resumed:false};
 if(code==='POST_SUBMIT_UNKNOWN')return {...recoveryOutcome('RECONCILIATION_NOT_FOUND'),code,causeCode:code,resumed:false};
 if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034')return {...recoveryOutcome('RECOVERY_CONFLICT'),resumed:false};
 const known=['PERMISSION_DENIED','APPROVAL_REVOKED','PACKAGE_CHANGED','RECOVERY_CONFLICT','RECOVERY_IN_PROGRESS','RECONCILIATION_BUDGET_EXHAUSTED'];
 return {...recoveryOutcome(error instanceof Error&&error.name==='ZodError'?'RECOVERY_INPUT_INVALID':code&&known.includes(code)?code:'PREPARATION_RECOVERY_FAILED'),resumed:false};
}
/** Generic supervised application, not a browser implementation or a producer/consumer activation. Default routes remain unsupported. */
export function createPreparationRecovery(options:Options={}){
 const deps=options.deps??browserDefaults,supervisor=options.supervisor,now=options.now??Date.now;
 const unsupported=()=>({...assessLegacyBrowserRecovery('BROWSER_UNAVAILABLE'),resumed:false});
 async function recover(input:unknown):Promise<Record<string,unknown>>{
  if(!supervisor)return unsupported();
  try{return {...await recoverPreparation(input,deps,supervisor,now)};}catch(error:unknown){return outcome(error);}
 }
 async function start(input:unknown){
  const args=browserBoundarySchema.parse(input);
  return startBrowserSubmission(args,deps,undefined,supervisor?.supports(args.snapshot)?(tx,a,id)=>admitPreparation(tx,a,id,supervisor):undefined);
 }
 async function pickup(input:unknown){
  if(!supervisor)return unsupported();const args=preparationPickup.parse(input);
  return deps.db.$transaction(async tx=>{
   const loaded=await loadPreparation(tx,deps,args,supervisor.executorId),{ledger,state}=loaded;
   if(ledger.generation!==args.generation||state.stage!=='PREPARE'||ledger.permitIssued||ledger.dispatchStarted||!['queued','preparing'].includes(ledger.state)||ledger.deadlineMs===null||now()>=ledger.deadlineMs)throw new Error('[RECOVERY_CONFLICT]');
   const work=await tx.workItem.findFirst({where:{id:state.workItemId,project_id:args.projectId,content_item_id:args.taskId,state:'claimed',lease_actor_id:args.actorId,lease_expires_at:{gt:new Date(now())}}});
   const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
   if(!work?.lease_token||row?.recovery_lease_sha256!==hash(work.lease_token)||!work.lease_expires_at||work.lease_expires_at.getTime()>ledger.deadlineMs)throw new Error('[RECOVERY_CONFLICT]');
   if(ledger.state==='queued'){
    await replacePreparation(tx,loaded.stored,{...ledger,state:'preparing',outbox:'claimed'});
    await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,command:'browser_preparation_pickup',after_state:{attempt_id:args.attemptId,generation:ledger.generation,submission_permitted:false}}});
   }
   return {generation:ledger.generation,workItemId:state.workItemId,leaseToken:work.lease_token,leaseExpiresAt:work.lease_expires_at!.toISOString(),submission_permitted:false,retry_allowed:false};
  },preparationSerial);
 }
 async function preSubmit(input:unknown,generation:number){
  if(!supervisor)throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');const args=browserObservedSchema.parse(input);
  return preSubmitBrowserSubmission(args,deps,undefined,async(tx,a,run)=>{
   const loaded=await loadPreparation(tx,deps,{...a,idempotencyKey:a.idempotencyKey},supervisor.executorId),{ledger,state}=loaded;
   if(ledger.generation!==generation||ledger.state!=='preparing'||ledger.permitIssued||ledger.dispatchStarted||(ledger.deadlineMs!==null&&now()>=ledger.deadlineMs))throw new Error('[RECOVERY_CONFLICT]');
   return withBrowserPreparationPermit(tx,{projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,generation,packageSha256:snapshotHash(a.snapshot),leaseSha256:hash(a.leaseToken)},async()=>{
    const result=await run();if(result.submission_permitted!==true)throw new Error('[RECOVERY_CONFLICT]');
    await replacePreparation(tx,loaded.stored,{...ledger,state:'permit_issued',permitIssued:true});
    const attempt=await tx.deliveryAttempt.findUnique({where:{id:a.attemptId}});
    const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:a.projectId,attempt_id:a.attemptId,execution_generation:generation,row_version:state.rowVersion,stage:'PREPARE'},data:{stage:'PERMIT_ISSUED',delivery_certainty:'POSSIBLY_SENT',state:'held',row_version:{increment:1},cause_code:'POST_SUBMIT_UNKNOWN',recovery_action:'READ_ONLY_RECONCILIATION',lookup_window_start_at:new Date(attempt!.created_at.getTime()-120000),lookup_window_end_at:new Date(now()+60000)}});
    if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');return result;
   });
  });
 }
 async function dispatch<T>(input:unknown,generation:number,send:()=>Promise<T>):Promise<T>{
  if(!supervisor)throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');const args=browserObservedSchema.parse(input);
  await deps.db.$transaction(async tx=>{
   const loaded=await loadPreparation(tx,deps,args,supervisor.executorId),{ledger,state}=loaded;
   if(ledger.generation!==generation||ledger.state!=='permit_issued'||!ledger.permitIssued||ledger.dispatchStarted||state.stage!=='PERMIT_ISSUED')throw new Error('[POST_SUBMIT_UNKNOWN]');
   const work=await tx.workItem.findUnique({where:{id:state.workItemId}});if(!work)throw new Error('[RECOVERY_CONFLICT]');assertBrowserLease(work,args);
   const permit=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,command:'ba_pre_submit_browser_submission',idempotency_key:args.idempotencyKey}});
   const proof=z.object({attempt_id:z.literal(args.attemptId),lease_sha256:z.literal(hash(args.leaseToken)),permit_expires_at:z.string().datetime(),submission_permitted:z.literal(true)}).passthrough().safeParse(permit?.after_state);
   if(!proof.success||Date.parse(proof.data.permit_expires_at)<=now())throw new Error('[POST_SUBMIT_UNKNOWN]');
   await replacePreparation(tx,loaded.stored,{...ledger,state:'dispatch_started',dispatchStarted:true});
   const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:args.projectId,attempt_id:args.attemptId,execution_generation:generation,row_version:state.rowVersion,stage:'PERMIT_ISSUED'},data:{stage:'DISPATCH_STARTED',row_version:{increment:1}}});if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
   await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,command:'browser_preparation_dispatch_started',after_state:{attempt_id:args.attemptId,generation}}});
  },preparationSerial);
  try{return await send();}catch{throw new Error('[POST_SUBMIT_UNKNOWN] The dispatch result is uncertain. Preserve the original attempt and use only read-only reconciliation; do not resend.');}
 }
 async function readyResult(args:PreparationRequest,generation:number,requireDispatch=false){
  if(!supervisor)throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
  await deps.db.$transaction(async tx=>{
   const loaded=await loadPreparation(tx,deps,args,supervisor.executorId),{ledger,state}=loaded;
   if(ledger.generation!==generation||!ledger.permitIssued||(requireDispatch&&!ledger.dispatchStarted)||!['permit_issued','dispatch_started','awaiting_result'].includes(ledger.state))throw new Error('[POST_SUBMIT_UNKNOWN]');
   if(ledger.state==='awaiting_result'){if(!['AWAITING_RESULT','RECONCILING'].includes(state.stage))throw new Error('[POST_SUBMIT_UNKNOWN]');return;}
   if(!['PERMIT_ISSUED','DISPATCH_STARTED'].includes(state.stage))throw new Error('[POST_SUBMIT_UNKNOWN]');
   await replacePreparation(tx,loaded.stored,{...ledger,state:'awaiting_result'});
   const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:args.projectId,attempt_id:args.attemptId,execution_generation:generation,row_version:state.rowVersion},data:{state:'idle',stage:'AWAITING_RESULT',delivery_certainty:'UNKNOWN',row_version:{increment:1}}});
   if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
  },preparationSerial);
 }
 async function confirm(input:unknown,generation:number){
  const args=browserReconcileSchema.parse(input);await readyResult(args,generation,true);
  const repository=createBrowserRecoveryRepository(deps,args.actorId),reserved=await repository.reserve({projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,packageSha256:snapshotHash(args.snapshot)},now());
  if(reserved.kind!=='reserved')throw new Error('[RECOVERY_CONFLICT]');
  return finalizeBrowserRecoverySubmission(args,reserved.reservation,new AbortController().signal,deps);
 }
 async function operation(input:unknown,readback?:BrowserRecoveryOperation):Promise<Record<string,unknown>|undefined>{
  if(!supervisor)return undefined;const args=browserUncertainSchema.parse(input),request=preparationRequest.parse({projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:args.actorId,idempotencyKey:args.idempotencyKey});
  const loaded=await deps.db.$transaction(async tx=>{
   const loaded=await loadPreparation(tx,deps,request,supervisor.executorId);
   if(loaded.ledger.state!=='queued'){const work=await tx.workItem.findUnique({where:{id:loaded.state.workItemId}});if(!work||work.lease_actor_id!==args.actorId||hash(work.lease_token||'')!==hash(args.leaseToken))throw new Error('[RECOVERY_CONFLICT]');}
   return loaded;
  },preparationSerial);
  if(loaded.state.stage==='PREPARE'){
   if(loaded.ledger.state==='queued')return {state:'preparing',attempt_id:args.attemptId,recovery:{...projectBrowserRecovery({code:'RECOVERY_PREPARE_RESUMED'}),generation:loaded.ledger.generation,resumed:true,replayed:true},submission_permitted:false,retry_allowed:false};
   if(args.reasonCode!=='BROWSER_UNAVAILABLE')return {state:'reconciliation_required',attempt_id:args.attemptId,recovery:unsupported(),submission_permitted:false,retry_allowed:false};
   const recovered=await recover({...request,idempotencyKey:`preparation:${args.attemptId}:${loaded.ledger.generation}`});return {state:recovered.resumed===true?'preparing':'reconciliation_required',attempt_id:args.attemptId,recovery:recovered,submission_permitted:false,retry_allowed:false};
  }
  await readyResult(request,loaded.ledger.generation);
  await deps.db.deliveryAttempt.updateMany({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,status:'pending',error_message:null},data:{error_message:'PROVIDER_RESULT_UNCERTAIN',requires_manual_confirmation:true}});
  const recovery=readback?await readback(args):recoveryOutcome('READBACK_CAPABILITY_UNAVAILABLE');
  return {state:recovery.code==='RECONCILIATION_FOUND'?'confirmed':'reconciliation_required',attempt_id:args.attemptId,recovery,submission_permitted:false,retry_allowed:false};
 }
 return {start,recover,pickup,preSubmit,dispatch,confirm,operation};
}
