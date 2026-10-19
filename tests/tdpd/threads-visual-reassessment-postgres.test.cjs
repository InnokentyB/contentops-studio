const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');const{randomUUID}=require('node:crypto');
require('ts-node/register/transpile-only');const base=process.env.THREADS_SOURCE||'/source/src';
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/threads_reliability_synthetic');
const{prisma:db,pool}=require(path.join(base,'db.ts'));
const{GenericThreadsReleaseService}=require(path.join(base,'services/threads_generic_release.service.ts'));
const{requestPublicationVisualReassessment}=require(path.join(base,'services/visual_reassessment.service.ts'));
const{digest}=require(path.join(base,'services/threads_api_contract.ts'));
const{createThreadsApiState}=require(path.join(base,'services/threads_api_store.ts'));
test.after(async()=>{await db.$disconnect();await pool.end();});
async function fixture(t){
 const nonce=randomUUID(),body='Accepted synthetic Threads copy.',now=Date.now(),manifest='sha256:'+'a'.repeat(64);
 const user=await db.user.create({data:{email:`thread-visual-${nonce}@example.invalid`,name:'Synthetic Owner',password_hash:'not-a-login'}});
 const project=await db.project.create({data:{name:'Synthetic immutable visual request',slug:nonce}});
 t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 const actorId=`user:${user.id}`;await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,name:'Synthetic Threads',type:'threads',is_active:true,
 config:{access_token:'synthetic-not-token',threads_user_id:'789',channel_username:'tester'}}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',item_key:nonce,
 draft_text:body,text_state:'accepted',content_revision:1,accepted_revision:1,status:'ready_for_execution',publication_mode:'approval_required',
 handoff_state:'ready',visual_mode:'auto_assess',visual_state:'NO_VISUAL_NEEDED',visual_placement:'feed',visual_decision_version:1,
 schedule_at:new Date(now-1000),publish_at:new Date(now-1000)}});
 const art=await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:`art-${nonce}`,kind:'art_direction',state:'completed',assignee_role:'art_director',input_context_version:1}});
 await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:`review-${nonce}`,kind:'content_review',state:'completed',assignee_role:'content_reviewer',input_context_version:1}});
 const decision=await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,work_item_id:art.id,
 source_content_revision:1,decision_version:1,channel:'threads',placement:'feed',decision:'NO_VISUAL_NEEDED',status:'active',actor_id:actorId,reason:'Original synthetic assessment'}});
 // Actual governed Owner operation creates the immutable request, not a forged flag or direct event insert.
 const request=await requestPublicationVisualReassessment({projectId:project.id,taskId:task.id,actorId,
 expectedContentRevision:1,expectedAcceptedRevision:1,expectedBodySha256:digest(body),expectedChannelId:channel.id,expectedPlacement:'feed',
 expectedScheduleAt:task.schedule_at.toISOString(),expectedDecisionId:decision.id,expectedDecisionVersion:1,expectedArtWorkItemId:art.id,
 requirement:'Explain the original mechanism with a meaningful visual.',reason:'Owner explicitly added a visual requirement after accepting text.',
 ownerInstructionReference:'Synthetic owner instruction for isolated acceptance',idempotencyKey:nonce,apply:true});
 assert.equal(request.applied,true);assert.ok(request.art_direction_work_item_id);
 // Simulate a historical projection writer. Immutable Owner request and original art input/history remain intact.
 await db.contentItem.update({where:{id:task.id},data:{status:'ready_for_execution',publication_mode:'approval_required',handoff_state:'ready',
 visual_mode:'auto_assess',visual_state:'NO_VISUAL_NEEDED',visual_decision_version:1,selected_asset_id:null}});
 let gets=0,posts=0;
 const threads={testConnection:async()=>{gets++;return{success:true,details:{id:'789',username:'tester'}};},
 getOwnPosts:async()=>{gets++;return{items:[],after:null};},publishVerifiedText:async()=>{posts++;throw Error('unexpected provider send');},
 readRecoveryProfile:async()=>{gets++;return{id:'789',username:'tester'};},readRecoveryPost:async()=>{gets++;return{id:'123',username:'tester',text:body,
 media_type:'TEXT_POST',is_reply:false,permalink:'https://www.threads.net/@tester/post/abc',timestamp:new Date(now).toISOString()};}};
 const service=new GenericThreadsReleaseService({db,threads,facts:{record:async()=>{throw Error('unexpected fact write');}},
 manifest:async()=>({project:{id:project.id,slug:project.slug},checksum:manifest}),now:()=>now,recoveryEnabled:true});
 const release={projectId:project.id,taskId:task.id,actorId,approvalReference:'Synthetic original owner release',expectedManifestChecksum:manifest,
 expectedAcceptedRevision:1,expectedContentRevision:1,expectedBodySha256:digest(body),expectedChannelId:channel.id,expectedScheduleAt:task.schedule_at.toISOString(),
 expectedVisualState:'NO_VISUAL_NEEDED',expectedSelectedAssetId:null,expectedPlacement:'feed',expectedThreadsUserId:'789',expectedUsername:'tester',idempotencyKey:'release'};
 return{service,user,project,task,channel,decision,actorId,manifest,release,body,now,get gets(){return gets;},get posts(){return posts;}};
}
test('Threads release respects immutable Owner visual request despite restored no-visual projections',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.release(f.release),/PUBLICATION_VISUAL_REVIEW_REQUIRED/);
 assert.equal(f.gets,0);assert.equal(f.posts,0);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);
 assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'ba_release_approved_threads_task'}}),0);
});
test('Threads pending reconciliation respects immutable Owner visual request before provider GET',async t=>{
 const f=await fixture(t);
 // Isolated historical recovery fixture only: an old writer bypassed the request. It must not acquire new confirmation authority.
 const proof={publication_authorized:true,task_id:f.task.id,channel_id:f.channel.id,accepted_revision:1,content_revision:1,
 body_sha256:digest(f.body),manifest_checksum:f.manifest,threads_user_id:'789',username:'tester',schedule_at:f.task.schedule_at.toISOString(),
 publish_at:f.task.publish_at.toISOString(),visual_state:'NO_VISUAL_NEEDED',selected_asset_id:null,placement:'feed',decision_id:f.decision.id,
 actor_id:f.actorId,release_idempotency_key:'historical-release'};
 const oldRelease=await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:f.actorId,
 command:'ba_release_approved_threads_task',idempotency_key:'historical-release',before_state:{approval_reference:'Synthetic original owner release'},after_state:proof}});
 const attempt=await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,
 mode:'automatic',status:'pending',requires_manual_confirmation:true,idempotency_key:'historical-send'}});
 await db.contentItem.update({where:{id:f.task.id},data:{status:'publishing',publication_mode:'owner_released'}});
 const row=await db.$transaction(tx=>createThreadsApiState(tx,{projectId:f.project.id,taskId:f.task.id,channelId:f.channel.id,
 actorId:f.actorId,manifestChecksum:f.manifest,revision:1,bodySha256:digest(f.body),releaseKey:'historical-release',
 releaseSha256:digest(JSON.stringify(oldRelease.after_state)),userId:'789',username:'tester'},attempt.id));
 await db.apiDeliveryRecovery.update({where:{id:row.id},data:{state:'provider_id_recorded',post_id:'123',container_id:'456',
 publish_started_at:new Date(f.now-500),observed_at:new Date(f.now+500)}});
 await assert.rejects(f.service.reconcile({projectId:f.project.id,taskId:f.task.id,attemptId:attempt.id,actorId:f.actorId,expectedManifestChecksum:f.manifest}),/PUBLICATION_VISUAL_REVIEW_REQUIRED/);
 assert.equal(f.gets,0);assert.equal(f.posts,0);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);
 assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);
 assert.equal((await db.apiDeliveryRecovery.findUnique({where:{id:row.id}})).requests_used,0);
});
test('Actual MCP preview reports immutable pending visual requirement despite restored local projections',async t=>{
 const f=await fixture(t);
 // A stale writer also restored a locally executable mode; request authority must still win.
 await db.contentItem.update({where:{id:f.task.id},data:{publication_mode:'owner_released'}});
 const{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 const{createPlannerMcpServer}=require(path.join(base,'mcp/shared.ts'));
 const principal={userId:f.user.id,actorId:f.actorId,projectId:f.project.id,profile:'publisher'};
 const server=createPlannerMcpServer({profile:'publisher',principal}),client=new Client({name:'visual-request-preview',version:'1'});
 const[a,b]=InMemoryTransport.createLinkedPair();const savedFetch=global.fetch;let externalCalls=0;
 global.fetch=async()=>{externalCalls++;throw Error('unexpected external access');};
 try{await server.connect(a);await client.connect(b);
 const response=await client.callTool({name:'ba_preview_publication_task',arguments:{projectId:f.project.id,taskId:f.task.id}});
 const result=response.structuredContent||JSON.parse(response.content[0].text);
 assert.equal(result.validation,'BLOCKED');assert.ok(result.blockers.some(block=>block.code==='PREVIEW_VISUAL_REASSESSMENT_REQUIRED'));
 assert.equal(result.provider_readiness,'NOT_CHECKED');assert.equal(result.submission_permitted,false);assert.equal(externalCalls,0);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);
 }finally{global.fetch=savedFetch;await client.close();await server.close();}
});
