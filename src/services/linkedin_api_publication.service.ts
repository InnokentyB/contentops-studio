import {z} from 'zod';
import prisma from '../db';
import publicationFactService from './publication_fact.service';
import {LinkedInApiAdapter} from './linkedin_api_adapter';
import {linkedinApiError,linkedinApiReadinessSchema,linkedinApiReleaseSchema,linkedinApiPublishSchema,linkedinApiReconcileSchema,linkedinDigest,linkedinObject,type LinkedInApiSnapshot} from './linkedin_api_contract';
import {inspectLinkedInPackage,checkLinkedInSnapshot,requireLinkedInOwner,verifiedLinkedInCredential,credentialSha,LINKEDIN_RELEASE_COMMAND,type CredentialResolver} from './linkedin_api_package';
import {linkedInSerial,createLinkedInState,advanceLinkedInState,loadLinkedInState,reserveLinkedInRead} from './linkedin_api_store';
import {admitLinkedInApiFinalizer} from './threads_api_fact_guard';
import {resolveLinkedInApiMedia} from './linkedin_api_media';
import {resolveLinkedInCredentials} from './linkedin_connection_credentials';
type Deps={db:typeof prisma;adapter:LinkedInApiAdapter;credentials:CredentialResolver;enabled:()=>boolean;now:()=>number;facts:typeof publicationFactService;media:typeof resolveLinkedInApiMedia};
const defaults:Deps={db:prisma,adapter:new LinkedInApiAdapter(),credentials:async(value,binding)=>{const c=resolveLinkedInCredentials(value,binding);return {...c.metadata,token:c.token,verified:c.verified};},enabled:()=>process.env.LINKEDIN_API_DELIVERY_ENABLED==='true',now:Date.now,facts:publicationFactService,media:resolveLinkedInApiMedia};
export class GenericLinkedInApiService{
 private readonly deps:Deps;
 constructor(deps:Partial<Deps>={}){this.deps={...defaults,...deps};}
 private enabled(){if(!this.deps.enabled())throw linkedinApiError('LINKEDIN_API_DISABLED');}
 async readiness(input:unknown){
  const a=linkedinApiReadinessSchema.parse(input);return this.deps.db.$transaction(async tx=>{
   await requireLinkedInOwner(tx,a);const channel=await tx.socialChannel.findFirst({where:{id:a.channelId,project_id:a.projectId,type:'linkedin'}});if(!channel)throw linkedinApiError('LINKEDIN_API_CONFLICT');
   try{const c=verifiedLinkedInCredential(await this.deps.credentials(channel.config,{projectId:a.projectId,channelId:channel.id}),this.deps.now(),false);return {ready:this.deps.enabled()&&channel.is_active,route:'linkedin_api',admission_enabled:this.deps.enabled(),author_urn:c.authorUrn,post_read:true,image_read_permission:c.imageReadAuthorized,image_read_probe:'not_performed',next_action:this.deps.enabled()?'Review the current accepted package before owner release.':'Request explicit route admission after read-only production readiness smoke.'};}
   catch{return {ready:false,route:'linkedin_api',admission_enabled:this.deps.enabled(),code:'LINKEDIN_API_GRANTS_REQUIRED',next_action:'Reconnect this exact channel with verified author, expiry and supported write/post-read/image-read permissions. No publication was attempted.'};}
  },linkedInSerial);
 }
 async release(input:unknown){
  const a=linkedinApiReleaseSchema.parse(input);this.enabled();return this.deps.db.$transaction(async tx=>{
   await requireLinkedInOwner(tx,a);const prior=await tx.workflowEvent.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,actor_id:a.actorId,command:LINKEDIN_RELEASE_COMMAND,idempotency_key:a.idempotencyKey}});
   if(prior){if(linkedinObject(prior.before_state).request_sha256!==linkedinDigest(JSON.stringify(a)))throw linkedinApiError('LINKEDIN_API_CONFLICT');return prior.after_state;}
   const c=await inspectLinkedInPackage(tx,a,this.deps.credentials,this.deps.now(),'approval_required');
   if(c.task.content_revision!==a.expectedContentRevision||c.task.channel_id!==a.expectedChannelId||c.bodySha256!==a.expectedBodySha256||c.task.selected_asset_id!==a.expectedSelectedAssetId||c.assetSha256!==a.expectedAssetSha256||c.decision.id!==a.expectedDecisionId||c.task.schedule_at?.toISOString()!==a.expectedScheduleAt||c.credential.authorUrn!==a.expectedAuthorUrn)throw linkedinApiError('LINKEDIN_API_CONFLICT');
   const proof={...a,connectionSha256:c.connectionSha256,publication_authorized:true,transport:'linkedin_api'};
   const changed=await tx.contentItem.updateMany({where:{id:a.taskId,project_id:a.projectId,updated_at:c.task.updated_at,publication_mode:'approval_required',status:'ready_for_execution'},data:{publication_mode:'owner_released'}});if(changed.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');
   await tx.workflowEvent.create({data:{project_id:a.projectId,content_item_id:a.taskId,actor_id:a.actorId,command:LINKEDIN_RELEASE_COMMAND,idempotency_key:a.idempotencyKey,before_state:{request_sha256:linkedinDigest(JSON.stringify(a))},after_state:proof}});return proof;
  },linkedInSerial);
 }
 async publish(input:unknown,callerSignal?:AbortSignal){
  const a=linkedinApiPublishSchema.parse(input);this.enabled();if(callerSignal?.aborted)throw linkedinApiError('LINKEDIN_API_INTERRUPTED');
  const claim=await this.deps.db.$transaction(async tx=>{
   await requireLinkedInOwner(tx,a);const release=await tx.workflowEvent.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,actor_id:a.actorId,command:LINKEDIN_RELEASE_COMMAND,idempotency_key:a.releaseIdempotencyKey},orderBy:{id:'desc'}});
   const proof=linkedinObject(release?.after_state);if(!release||proof.publication_authorized!==true||proof.transport!=='linkedin_api')throw linkedinApiError('LINKEDIN_API_CONFLICT');
   const args=linkedinApiReleaseSchema.parse(Object.fromEntries(Object.entries(proof).filter(([k])=>!['connectionSha256','publication_authorized','transport'].includes(k))));
   const snapshot:LinkedInApiSnapshot={...args,version:1,connectionSha256:z.string().regex(/^[a-f0-9]{64}$/).parse(proof.connectionSha256),releaseSha256:linkedinDigest(JSON.stringify(release.after_state))};
   if(args.projectId!==a.projectId||args.taskId!==a.taskId||args.actorId!==a.actorId||args.expectedManifestChecksum!==a.expectedManifestChecksum)throw linkedinApiError('LINKEDIN_API_CONFLICT');
   const c=await checkLinkedInSnapshot(tx,snapshot,this.deps.credentials,this.deps.now());
   if(a.dryRun)return {snapshot,attemptId:null,task:c.task,credential:c.credential};
   if(this.deps.now()<Date.parse(snapshot.expectedScheduleAt))throw linkedinApiError('LINKEDIN_API_NOT_DUE');
   const changed=await tx.contentItem.updateMany({where:{id:a.taskId,project_id:a.projectId,updated_at:c.task.updated_at,status:'ready_for_execution',publication_mode:'owner_released'},data:{status:'publishing'}});if(changed.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');
   const attempt=await tx.deliveryAttempt.create({data:{project_id:a.projectId,content_item_id:a.taskId,channel_id:c.task.channel_id!,mode:'automatic',status:'pending',attempt_number:1,idempotency_key:a.idempotencyKey,scheduled_at:c.task.schedule_at,requires_manual_confirmation:true}});
   await createLinkedInState(tx,snapshot,attempt.id);return {snapshot,attemptId:attempt.id,task:c.task,credential:c.credential};
  },linkedInSerial);
  if(claim.attemptId===null)return {mode:'dry_run',published:false,route:'linkedin_api'};
  const scope={...a,attemptId:claim.attemptId};
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000);
  const auth={author:claim.credential.authorUrn,token:claim.credential.token,signal};
  const stage=async(from:string,to:string,data:Parameters<typeof advanceLinkedInState>[4]={})=>this.deps.db.$transaction(async tx=>{
   if(signal.aborted)throw linkedinApiError('LINKEDIN_API_INTERRUPTED');this.enabled();await checkLinkedInSnapshot(tx,claim.snapshot,this.deps.credentials,this.deps.now(),scope.attemptId);await advanceLinkedInState(tx,scope,from,to,data);
  },linkedInSerial);
  let publicDispatchStarted=false;
  try{
   let imageId:string|undefined;
   if(claim.snapshot.expectedSelectedAssetId!==null){
    if(!claim.task.selected_asset?.file_url)throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');
    const bytes=await this.deps.media({...claim.task.selected_asset,file_url:claim.task.selected_asset.file_url},{projectId:a.projectId,taskId:a.taskId,assetId:claim.snapshot.expectedSelectedAssetId,sha256:claim.snapshot.expectedAssetSha256!},signal);
    await stage('claimed','image_initialize_started');const image=await this.deps.adapter.initializeImage(auth);imageId=image.id;
    await this.deps.db.$transaction(tx=>advanceLinkedInState(tx,scope,'image_initialize_started','image_initialized',{container_id:image.id}),linkedInSerial);
    await stage('image_initialized','image_upload_started');await this.deps.adapter.uploadImage(image.uploadUrl,bytes,signal);
    await stage('image_upload_started','image_uploaded');
    // One bounded readiness read; incomplete preparation is held, never replayed automatically.
    if(!await this.deps.adapter.readImage(image.id,auth))throw linkedinApiError('LINKEDIN_API_IMAGE_PROCESSING');await stage('image_uploaded','image_ready');
   }
   await stage(imageId?'image_ready':'claimed','dispatch_started',{publish_started_at:new Date(this.deps.now())});publicDispatchStarted=true;
   const postId=await this.deps.adapter.publish({...auth,text:claim.task.draft_text!,imageId});
   // Persist causal receipt even if authority changed after provider acceptance; no new send authority granted.
   await this.deps.db.$transaction(tx=>advanceLinkedInState(tx,scope,'dispatch_started','provider_id_recorded',{post_id:postId,observed_at:new Date(this.deps.now())}),linkedInSerial);
   return await this.reconcile({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,expectedManifestChecksum:a.expectedManifestChecksum,attemptId:scope.attemptId},signal);
  }catch(error:unknown){ const candidate=error instanceof Error?/^\[(LINKEDIN_API_[A-Z_]+)\]/.exec(error.message)?.[1]:undefined;const cause=candidate&&['LINKEDIN_API_UNKNOWN','LINKEDIN_API_CONFLICT','LINKEDIN_API_MEDIA_INVALID','LINKEDIN_API_PROVIDER_UNAVAILABLE','LINKEDIN_API_IMAGE_PROCESSING','LINKEDIN_API_INTERRUPTED','LINKEDIN_API_DISABLED','LINKEDIN_API_OWNER_REQUIRED','LINKEDIN_API_GRANTS_REQUIRED','LINKEDIN_API_READ_BUDGET','LINKEDIN_API_READ_IN_PROGRESS','LINKEDIN_API_READ_BACKOFF'].includes(candidate)?candidate:'LINKEDIN_API_UNKNOWN';return {status:publicDispatchStarted?'UNKNOWN':'held',attempt_id:scope.attemptId,cause_code:cause,code:publicDispatchStarted?'LINKEDIN_API_UNKNOWN':cause,published:false,next_action:publicDispatchStarted?'Inspect and reconcile this same attempt only. Do not resend, create a replacement task or switch to browser.':'Inspect the held preparation, canonical asset and current connection/owner authority. No public POST began; preparation is not automatically replayable.'}; }
 }
 async reconcile(input:unknown,callerSignal?:AbortSignal){
  const a=linkedinApiReconcileSchema.parse(input);this.enabled();if(callerSignal?.aborted)throw linkedinApiError('LINKEDIN_API_INTERRUPTED');
  const read=await this.deps.db.$transaction(async tx=>{await requireLinkedInOwner(tx,a);const s=await loadLinkedInState(tx,a);if(s.snapshot.actorId!==a.actorId||s.snapshot.expectedManifestChecksum!==a.expectedManifestChecksum)throw linkedinApiError('LINKEDIN_API_CONFLICT');const c=await checkLinkedInSnapshot(tx,s.snapshot,this.deps.credentials,this.deps.now(),a.attemptId);return {...await reserveLinkedInRead(tx,a,this.deps.now()),credential:c.credential};},linkedInSerial);
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(Math.max(1,read.expires.getTime()-this.deps.now()))]):AbortSignal.timeout(Math.max(1,read.expires.getTime()-this.deps.now()));
  try{
   const post=await this.deps.adapter.readPost(read.row.post_id!,{author:read.credential.authorUrn,token:read.credential.token,signal});
   if(post.author!==read.snapshot.expectedAuthorUrn||linkedinDigest(post.commentary)!==read.snapshot.expectedBodySha256||post.publishedAt<read.row.publish_started_at!.getTime()-1000||post.publishedAt>read.row.observed_at!.getTime()+60000||(read.snapshot.expectedSelectedAssetId===null?Boolean(post.content?.media):post.content?.media?.id!==read.row.container_id))throw linkedinApiError('LINKEDIN_API_CONFLICT');
   const check=async(tx:Parameters<typeof checkLinkedInSnapshot>[0])=>{
    if(signal.aborted||!this.deps.enabled()||this.deps.now()>=read.expires.getTime())throw linkedinApiError('LINKEDIN_API_INTERRUPTED');
    const c=await checkLinkedInSnapshot(tx,read.snapshot,this.deps.credentials,this.deps.now(),a.attemptId);if(credentialSha(c.credential)!==credentialSha(read.credential))throw linkedinApiError('LINKEDIN_API_CONFLICT');
    const {row}=await loadLinkedInState(tx,a);if(row.post_id!==post.id||row.lease_sha256!==read.lease||row.state!=='provider_id_recorded'||!row.lease_expires_at||row.lease_expires_at.getTime()<=this.deps.now())throw linkedinApiError('LINKEDIN_API_CONFLICT');
   };
   await this.deps.facts.record({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,artifactKind:'post',outcome:'published',publishedAt:new Date(post.publishedAt).toISOString(),publicUrl:`https://www.linkedin.com/feed/update/${post.id}/`,providerObjectId:post.id,confirmationMode:'automatic',evidence:{type:'api',ref:`sha256:${linkedinDigest(JSON.stringify({attemptId:a.attemptId,postId:post.id,body:read.snapshot.expectedBodySha256,image:read.row.container_id}))}`},beforeWrite:async tx=>{
    await check(tx);const duplicate=await tx.publicationFact.findFirst({where:{project_id:a.projectId,provider_object_id:post.id,content_item_id:{not:a.taskId},channel:{type:'linkedin'}}});if(duplicate)throw linkedinApiError('LINKEDIN_API_CONFLICT');const changed=await tx.deliveryAttempt.updateMany({where:{id:a.attemptId,project_id:a.projectId,content_item_id:a.taskId,status:'pending'},data:{status:'delivered',actual_published_at:new Date(post.publishedAt),requires_manual_confirmation:false}});if(changed.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');
    const done=await tx.apiDeliveryRecovery.updateMany({where:{id:read.row.id,project_id:a.projectId,lease_sha256:read.lease,state:'provider_id_recorded'},data:{state:'confirmed',lease_sha256:null,lease_expires_at:null,row_version:{increment:1}}});if(done.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');admitLinkedInApiFinalizer(tx,a,post.id);
   },beforeCommit:async tx=>{if(signal.aborted||!this.deps.enabled()||this.deps.now()>=read.expires.getTime())throw linkedinApiError('LINKEDIN_API_INTERRUPTED');await requireLinkedInOwner(tx,a);}});
   return {status:'confirmed',attempt_id:a.attemptId,published:true,provider_object_id:post.id};
  }finally{
   await this.deps.db.apiDeliveryRecovery.updateMany({where:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId,transport:'linkedin_api',lease_sha256:read.lease},data:{lease_sha256:null,lease_expires_at:null,row_version:{increment:1}}});
  }
 }
}
export const linkedinApiPublicationService=new GenericLinkedInApiService();
