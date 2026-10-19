const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'http://invalid');assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/shared_browser_synthetic');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';const {prisma:db,pool}=require(path.join(base,'db.js'));
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');const {Client}=require('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {registerOwnerRepairTools}=require(path.join(base,'mcp/tools/owner_repair_tools.js'));
const {registerMediaMetricsTools}=require(path.join(base,'mcp/tools/media_metrics_tools.js'));
const {registerWorkQueueTools}=require(path.join(base,'mcp/tools/work_queue_tools.js'));
const {registerBrowserPublicationTools}=require(path.join(base,'mcp/tools/browser_publication_tools.js'));
const digest=s=>createHash('sha256').update(s).digest('hex');
test.after(async()=>{await db.$disconnect();await pool.end();});
async function fixture(t){
 const nonce=randomUUID(),body='Accepted copy remains exactly unchanged.';
 const user=await db.user.create({data:{email:`visual-${nonce}@example.invalid`,name:'Synthetic owner',password_hash:'synthetic-not-login'}});
 const project=await db.project.create({data:{name:'Synthetic reassessment',slug:nonce}});await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,name:'Synthetic LinkedIn',type:'linkedin',config:{},is_active:true}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',draft_text:body,status:'ready_for_execution',publication_mode:'approval_required',text_state:'accepted',content_revision:2,accepted_revision:2,visual_state:'NO_VISUAL_NEEDED',handoff_state:'ready',visual_mode:'auto_assess',visual_placement:'feed',visual_decision_version:1,schedule_at:new Date('2030-01-01T12:00:00Z')}});
 const wi=await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:'synthetic',kind:'art_direction',state:'completed',assignee_role:'art_director',input_context_version:2,result_version:1,dedupe_key:`initial:${nonce}`}});
 const decision=await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,work_item_id:wi.id,source_content_revision:2,decision_version:1,channel:'linkedin',placement:'feed',decision:'NO_VISUAL_NEEDED',status:'active',actor_id:`user:${user.id}`,reason:'Prior assessment'}});
 const args={projectId:project.id,taskId:task.id,actorId:`user:${user.id}`,expectedContentRevision:2,expectedAcceptedRevision:2,expectedBodySha256:digest(body),expectedChannelId:channel.id,expectedPlacement:'feed',expectedScheduleAt:task.schedule_at.toISOString(),expectedDecisionId:decision.id,expectedDecisionVersion:1,expectedArtWorkItemId:wi.id,requirement:'Explain the key mechanism using a meaningful original visual.',reason:'Owner added a visual requirement after accepting copy.',ownerInstructionReference:'Synthetic owner instruction, no external authorization assertion',idempotencyKey:nonce,apply:true};
 const server=new McpServer({name:'synthetic-visual',version:'1'});registerOwnerRepairTools(server);registerMediaMetricsTools(server);registerWorkQueueTools(server);registerBrowserPublicationTools(server);const client=new Client({name:'operator',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 t.after(async()=>{await client.close();await server.close();await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 assert.ok((await client.listTools()).tools.some(tool=>tool.name==='ba_request_publication_visual_reassessment'),'Generic reassessment tool is missing');
 const call=async overrides=>{const result=await client.callTool({name:'ba_request_publication_visual_reassessment',arguments:{...args,...overrides}});const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('');return{...result,value:result.isError?{error:text}:JSON.parse(text)};};
 const rpc=async(name,args)=>{const result=await client.callTool({name,arguments:args});const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('');if(result.isError)throw Error(text);return JSON.parse(text);};
 return{args,call,rpc,task,wi,decision,project,user,body};
}
test('REL05 MCP preview has zero writes; apply preserves accepted package/history and opens exactly one new input',async t=>{
 const f=await fixture(t);const before=await db.contentItem.findUnique({where:{id:f.task.id}});const events=await db.workflowEvent.count({where:{project_id:f.project.id}});
 const preview=await f.call({apply:false});assert.notEqual(preview.isError,true);assert.equal(preview.value.applied,false);assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),events);
 const applied=await f.call({});assert.notEqual(applied.isError,true);assert.equal(applied.value.applied,true);
 const after=await db.contentItem.findUnique({where:{id:f.task.id}});for(const k of ['draft_text','content_revision','accepted_revision','channel_id','schedule_at'])assert.deepEqual(after[k],before[k]);assert.equal(after.visual_mode,'required');assert.equal(after.visual_state,'PENDING_ASSESSMENT');assert.equal(after.handoff_state,'blocked');assert.equal(after.status,'approved');
 assert.equal((await db.workItem.findUnique({where:{id:f.wi.id}})).state,'completed');assert.equal((await db.artDirectionDecision.findUnique({where:{id:f.decision.id}})).status,'active');
 assert.equal(await db.workItem.count({where:{project_id:f.project.id,kind:'art_direction',state:'available'}}),1);assert.equal(await db.deliveryAttempt.count({where:{project_id:f.project.id}}),0);
 const replay=await f.call({});assert.equal(replay.value.replayed,true);const changed=await f.call({requirement:'A different request changes the normalized packet.'});assert.equal(changed.isError,true);
});
test('REL05 stale guards and non-owner calls cause zero changes, no evidence leaks',async t=>{
 const f=await fixture(t);for(const patch of [{expectedBodySha256:'f'.repeat(64)},{expectedDecisionVersion:2},{expectedChannelId:f.args.expectedChannelId+1},{expectedScheduleAt:'2031-01-01T12:00:00Z'},{actorId:'user:999999999'}]){const denied=await f.call(patch);assert.equal(denied.isError,true);assert.equal(await db.workItem.count({where:{project_id:f.project.id}}),1);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);}
});
test('REL05 any delivery attempt including uncertain blocks reassessment without changing history',async t=>{
 const f=await fixture(t);await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.args.expectedChannelId,status:'pending',requires_manual_confirmation:true}});
 const result=await f.call({});assert.equal(result.isError,true);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_state,'NO_VISUAL_NEEDED');assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);
});
test('REL05 concurrent identical requests create one generation and one immutable request event',async t=>{
 const f=await fixture(t);const result=await Promise.all([f.call({}),f.call({})]);assert.equal(result.filter(r=>r.isError===true).length,0,JSON.stringify(result.map(r=>r.value)));assert.equal(await db.workItem.count({where:{project_id:f.project.id,kind:'art_direction'}}),2);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id,command:'ba_request_publication_visual_reassessment'}}),1);
});
test('REL05 disabled pipeline cannot bypass request; old asset callback cannot restore old readiness',async t=>{
 const f=await fixture(t);const applied=await f.call({});assert.notEqual(applied.isError,true);
 const art=require(path.join(base,'services/art_direction.service.js')).default;const image=require(path.join(base,'services/image_asset.service.js')).default;
 const context=await art.getContext(f.project.id,applied.value.art_direction_work_item_id);assert.equal(context.visual_reassessment.requirement,f.args.requirement);assert.equal(context.content.accepted_text,f.body);
 await db.projectSettings.create({data:{project_id:f.project.id,key:'art_direction_pipeline_enabled',value:'false'}});assert.equal((await art.getReadiness(f.project.id,f.task.id)).ready,false);
 const old=await db.imageAsset.create({data:{project_id:f.project.id,content_item_id:f.task.id,decision_id:f.decision.id,content_revision:2,placement:'feed',prompt:'Historical synthetic candidate',file_url:'https://example.invalid/old.png'}});
 await assert.rejects(image.reviewImageAsset({projectId:f.project.id,actorId:f.args.actorId,assetId:old.id,decision:'approved'}),/VISUAL_REASSESSMENT_DECISION_CONFLICT/);
 assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_state,'PENDING_ASSESSMENT');assert.equal((await db.imageAsset.findUnique({where:{id:old.id}})).status,'candidate');
 await assert.rejects(art.submitDecision({projectId:f.project.id,workItemId:f.wi.id,actorId:f.args.actorId,leaseToken:'old',idempotencyKey:'late-old',decision:{decision:'NO_VISUAL_NEEDED',source_content_revision:2,channel:'linkedin',placement:'feed',reason:'Late old callback'}}),/VISUAL_REASSESSMENT_GENERATION_CONFLICT/);
});
test('REL05 new assessment requires visual and separate current review lease/generation before atomic fulfilment',async t=>{
 const f=await fixture(t),applied=await f.call({});assert.notEqual(applied.isError,true);const request=applied.value.binding;
 const art={submitDecision:args=>f.rpc('ba_submit_art_direction_decision',args),attachVisualSource:args=>f.rpc('ba_attach_visual_source',args),getReadiness:(projectId,contentItemId)=>f.rpc('ba_get_visual_readiness',{projectId,contentItemId,actorId:f.args.actorId})};const image={reviewImageAsset:args=>f.rpc('ba_review_image_asset',args)};
 const workId=applied.value.art_direction_work_item_id;await db.workItem.update({where:{id:workId},data:{state:'claimed',lease_actor_id:f.args.actorId,lease_token:'synthetic-art-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const submit={projectId:f.project.id,workItemId:workId,actorId:f.args.actorId,leaseToken:'synthetic-art-lease',idempotencyKey:'new-decision',decision:{decision:'NO_VISUAL_NEEDED',source_content_revision:2,channel:'linkedin',placement:'feed',reason:'Visual would not add anything'}};
 await assert.rejects(art.submitDecision(submit),/VISUAL_REASSESSMENT_OWNER_VISUAL_REQUIRED/);assert.equal((await db.artDirectionDecision.findUnique({where:{id:f.decision.id}})).status,'active');
 const selected=await art.submitDecision({...submit,decision:{...submit.decision,decision:'SOURCE_REQUIRED',reason:'The required visual explains the mechanism',loss_without_visual:'The mechanism is hard to follow in text alone'}});
 assert.equal((await art.getReadiness(f.project.id,f.task.id)).ready,false);assert.equal((await db.artDirectionDecision.findUnique({where:{id:f.decision.id}})).status,'superseded');
 const source={projectId:f.project.id,actorId:f.args.actorId,contentItemId:f.task.id,fileUrl:'https://example.invalid/current.png',provenance:{source:'synthetic-test',license:'synthetic'},altText:'Synthetic meaningful visual',decisionId:selected.decision_id,reassessmentGeneration:request.generation};
 await assert.rejects(art.attachVisualSource({...source,decisionId:f.decision.id}),/VISUAL_REASSESSMENT_GENERATION_CONFLICT/);await assert.rejects(art.attachVisualSource({...source,reassessmentGeneration:randomUUID()}),/VISUAL_REASSESSMENT_GENERATION_CONFLICT/);
 const attached=await art.attachVisualSource(source);
 const wi=await db.workItem.findFirst({where:{project_id:f.project.id,content_item_id:f.task.id,kind:'visual_review'}});await db.workItem.update({where:{id:wi.id},data:{state:'claimed',lease_actor_id:f.args.actorId,lease_token:'synthetic-review-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const review={projectId:f.project.id,actorId:f.args.actorId,assetId:attached.asset_id,decision:'approved',workItemId:wi.id,reassessmentGeneration:request.generation,leaseToken:'synthetic-review-lease'};
 await assert.rejects(f.rpc('ba_complete_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId:wi.id,leaseToken:review.leaseToken,result:{text:'Cannot replace actual asset review'},idempotencyKey:'wrong-review-completion'}),/VISUAL_REASSESSMENT_TYPED_COMPLETION_REQUIRED/);
 await assert.rejects(image.reviewImageAsset({...review,leaseToken:'wrong'}),/VISUAL_REASSESSMENT_REVIEW_LEASE_REQUIRED/);await assert.rejects(image.reviewImageAsset({...review,reassessmentGeneration:randomUUID()}),/VISUAL_REASSESSMENT_GENERATION_CONFLICT/);
 await assert.rejects(image.reviewImageAsset({...review,workItemId:undefined,leaseToken:undefined}),/VISUAL_REASSESSMENT_REVIEW_LEASE_REQUIRED/);
 await db.workItem.update({where:{id:wi.id},data:{lease_expires_at:new Date(Date.now()-1000)}});await assert.rejects(image.reviewImageAsset(review),/VISUAL_REASSESSMENT_REVIEW_LEASE_REQUIRED/);await db.workItem.update({where:{id:wi.id},data:{lease_expires_at:new Date(Date.now()+60000)}});
 const originalFind=db.imageAsset.findFirst.bind(db.imageAsset);let observed,unlock;const observedRead=new Promise(r=>{observed=r}),unlockWriter=new Promise(r=>{unlock=r});let rowLocked;const locked=new Promise(r=>{rowLocked=r});
 db.imageAsset.findFirst=async args=>{const row=await originalFind(args);observed();return row;};
 const concurrentWriter=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM planner.content_items WHERE id=${f.task.id} FOR UPDATE`;rowLocked();await unlockWriter;await tx.imageAsset.update({where:{id:attached.asset_id},data:{file_url:'file:///private-stale-source'}});});
 try{await locked;const staleReview=image.reviewImageAsset(review);await observedRead;unlock();await concurrentWriter;await assert.rejects(staleReview,/VISUAL_REASSESSMENT_ASSET_NOT_DURABLE/);assert.equal((await db.imageAsset.findUnique({where:{id:attached.asset_id}})).status,'candidate');assert.equal((await db.workItem.findUnique({where:{id:wi.id}})).state,'claimed');}
 finally{unlock();db.imageAsset.findFirst=originalFind;await db.imageAsset.update({where:{id:attached.asset_id},data:{file_url:'https://example.invalid/current.png'}});}
 await db.$executeRawUnsafe("CREATE FUNCTION planner.rel05_reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command='ba_complete_publication_visual_reassessment' THEN RAISE EXCEPTION 'private-completion-secret-marker'; END IF; RETURN NEW; END $$");await db.$executeRawUnsafe('CREATE TRIGGER rel05_reject_completion BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.rel05_reject_completion()');
 try{await assert.rejects(image.reviewImageAsset(review),error=>/VISUAL_REASSESSMENT_STORAGE_OR_PLACEMENT_CHECK_FAILED/.test(error.message)&&!error.message.includes('private-completion-secret-marker'));assert.equal((await db.imageAsset.findUnique({where:{id:attached.asset_id}})).status,'candidate');assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).selected_asset_id,null);assert.equal((await db.workItem.findUnique({where:{id:wi.id}})).state,'claimed');assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id,command:'ba_complete_publication_visual_reassessment'}}),0);}
 finally{await db.$executeRawUnsafe('DROP TRIGGER rel05_reject_completion ON planner.workflow_events');await db.$executeRawUnsafe('DROP FUNCTION planner.rel05_reject_completion()');}
 await image.reviewImageAsset(review);const final=await art.getReadiness(f.project.id,f.task.id);assert.equal(final.ready,true);assert.equal(final.selected_asset.decision_id,selected.decision_id);
 assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id,command:'ba_complete_publication_visual_reassessment'}}),1);assert.equal((await db.workItem.findUnique({where:{id:wi.id}})).state,'completed');assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).draft_text,f.body);
});
test('REL05 direct claim wins before request: request cannot create authority during in-flight send',async t=>{
 const f=await fixture(t);let locked,release;const held=new Promise(r=>{locked=r}),go=new Promise(r=>{release=r});
 const claim=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM planner.content_items WHERE id=${f.task.id} FOR UPDATE`;locked();await go;return tx.contentItem.updateMany({where:{id:f.task.id,status:'ready_for_execution'},data:{status:'publishing'}});});await held;
 const pending=f.call({});release();assert.equal((await claim).count,1);const result=await pending;assert.equal(result.isError,true);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);
});
test('REL05 request wins before stale direct claim: status CAS fails and creates no dispatch',async t=>{
 const f=await fixture(t);await f.call({});const claim=await db.contentItem.updateMany({where:{id:f.task.id,status:{in:['planned','ready_for_execution']}},data:{status:'publishing'}});assert.equal(claim.count,0);assert.equal(await db.deliveryAttempt.count({where:{project_id:f.project.id}}),0);
});
test('REL05 request audit failure rolls back new input, status and request together with safe operator error',async t=>{
 const f=await fixture(t);await db.$executeRawUnsafe("CREATE FUNCTION planner.rel05_reject_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command='ba_request_publication_visual_reassessment' THEN RAISE EXCEPTION 'synthetic audit unavailable private-secret-marker'; END IF; RETURN NEW; END $$");
 await db.$executeRawUnsafe('CREATE TRIGGER rel05_reject_request BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.rel05_reject_request()');
 try{const denied=await f.call({});assert.equal(denied.isError,true);assert.match(denied.value.error,/VISUAL_REASSESSMENT_STORAGE_OR_PLACEMENT_CHECK_FAILED/);assert.equal(denied.value.error.includes('private-secret-marker'),false);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_state,'NO_VISUAL_NEEDED');assert.equal(await db.workItem.count({where:{project_id:f.project.id}}),1);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);}
 finally{await db.$executeRawUnsafe('DROP TRIGGER rel05_reject_request ON planner.workflow_events');await db.$executeRawUnsafe('DROP FUNCTION planner.rel05_reject_request()');}
});
test('REL05 leased executor or release projection denies request and does not revoke prior authority',async t=>{
 const f=await fixture(t);await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:'execution',kind:'browser_publish',state:'claimed',assignee_role:'browser_publisher',lease_token:'synthetic-executor',lease_actor_id:f.args.actorId,lease_expires_at:new Date(Date.now()+60000)}});
 const denied=await f.call({});assert.equal(denied.isError,true);assert.match(denied.value.error,/VISUAL_REASSESSMENT_EXISTING_AUTHORITY/);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_mode,'auto_assess');
});
test('REL05 mismatched active decision channel or placement and duplicate active decisions reject',async t=>{
 for(const mutation of [{channel:'threads'},{placement:'article_cover'}]){const f=await fixture(t);await db.artDirectionDecision.update({where:{id:f.decision.id},data:mutation});const denied=await f.call({});assert.equal(denied.isError,true);assert.match(denied.value.error,/VISUAL_REASSESSMENT_PRIOR_INPUT_CONFLICT/);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),0);}
 const f=await fixture(t);await db.artDirectionDecision.create({data:{project_id:f.project.id,content_item_id:f.task.id,work_item_id:f.wi.id,source_content_revision:2,decision_version:2,channel:'linkedin',placement:'feed',decision:'NO_VISUAL_NEEDED',status:'active',actor_id:f.args.actorId,reason:'Synthetic inconsistent concurrent active decision'}});const denied=await f.call({});assert.equal(denied.isError,true);assert.match(denied.value.error,/VISUAL_REASSESSMENT_PRIOR_INPUT_CONFLICT/);
});
test('REL05 generic completion cannot strand the new art input; release/reclaim then typed assessment remains usable',async t=>{
 const f=await fixture(t),requested=await f.call({});assert.notEqual(requested.isError,true);const workItemId=requested.value.art_direction_work_item_id;
 const claim=await f.rpc('ba_claim_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId,idempotencyKey:'current-art-claim'});
 await assert.rejects(f.rpc('ba_complete_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId,leaseToken:claim.lease_token,result:{body:'Cannot replace a typed art decision'},idempotencyKey:'wrong-completion'}),/VISUAL_REASSESSMENT_TYPED_COMPLETION_REQUIRED/);
 assert.equal((await db.workItem.findUnique({where:{id:workItemId}})).state,'claimed');assert.equal((await db.artDirectionDecision.findUnique({where:{id:f.decision.id}})).status,'active');
 await f.rpc('ba_release_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId,leaseToken:claim.lease_token,idempotencyKey:'release-current-lease'});
 const again=await f.rpc('ba_claim_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId,idempotencyKey:'reclaim-current-art'});
 const assessed=await f.rpc('ba_submit_art_direction_decision',{projectId:f.project.id,actorId:f.args.actorId,workItemId,leaseToken:again.lease_token,idempotencyKey:'canonical-completion',decision:{decision:'SOURCE_REQUIRED',source_content_revision:2,channel:'linkedin',placement:'feed',reason:'Use meaningful owner documentation',loss_without_visual:'The mechanism needs an explanatory image'}});assert.equal(assessed.decision_version,2);
});
test('REL05 actual browser release races Owner reassessment: only one lifecycle can commit',async t=>{
 const f=await fixture(t);const template=require('./shared-linkedin-text-only.fixture.cjs').textOnlyFixture();
 await db.socialChannel.update({where:{id:f.args.expectedChannelId},data:{name:template.f.state.task.channel.name,config:template.f.state.task.channel.config}});
 await db.contentItem.update({where:{id:f.task.id},data:{draft_text:template.body,publish_at:f.task.schedule_at,quality_report:template.f.state.task.quality_report}});f.args.expectedBodySha256=digest(template.body);
 const manifest=await require(path.join(base,'services/agent_workspace_manifest.service.js')).loadAgentWorkspaceManifest(f.project.id,f.user.id);
 const snapshot={...template.args.snapshot,projectId:f.project.id,taskId:f.task.id,channelId:f.args.expectedChannelId,contentRevision:2,bodySha256:digest(template.body),decisionId:f.decision.id,decisionVersion:1,scheduleAt:f.args.expectedScheduleAt,publishAt:f.args.expectedScheduleAt,manifestChecksum:manifest.checksum};
 const release={projectId:f.project.id,taskId:f.task.id,actorId:f.args.actorId,snapshot,approvalReference:'Synthetic exact package Owner release',idempotencyKey:'synthetic-browser-release',apply:true};
 await f.rpc('ba_repair_browser_publication_metadata',{...release,idempotencyKey:'synthetic-metadata'});
 const defaults=require(path.join(base,'services/browser_publication_contract.js')).browserDefaults,originalManifest=defaults.manifest;
 let arrived,resume;const atBarrier=new Promise(r=>{arrived=r}),continueRelease=new Promise(r=>{resume=r});
 defaults.manifest=async(...args)=>{const value=await originalManifest(...args);arrived();await continueRelease;return value;};
 const browser=f.rpc('ba_release_browser_publication',release).then(value=>({value}),error=>({error}));
 try{await Promise.race([atBarrier,browser.then(()=>{throw Error('Release did not reach the synthetic Serializable read barrier');})]);const request=await f.call({});assert.notEqual(request.isError,true);resume();const result=await browser;assert.ok(result.error,'Stale browser release must lose after reassessment commits');assert.match(result.error.message,/BROWSER_STATE_CONFLICT/);assert.equal(result.error.message.includes('BROWSER_REQUEST_FAILED'),false);}
 finally{resume();defaults.manifest=originalManifest;}
 const task=await db.contentItem.findUnique({where:{id:f.task.id}});assert.ok(['approved','browser_required'].includes(task.status));
 const active=await db.workItem.findMany({where:{project_id:f.project.id,state:'available',kind:{in:['art_direction','browser_publish']}}});assert.equal(active.length,1);assert.equal(await db.deliveryAttempt.count({where:{project_id:f.project.id}}),0);
 if(task.status==='approved'){assert.equal(active[0].kind,'art_direction');assert.equal(task.visual_state,'PENDING_ASSESSMENT');}else{assert.equal(active[0].kind,'browser_publish');assert.equal(task.visual_state,'NO_VISUAL_NEEDED');}
});
test('REL05 old content writer races reassessment: accepted copy cannot change after request commits',async t=>{
 const f=await fixture(t),art=require(path.join(base,'services/art_direction.service.js')).default;
 await db.projectSettings.create({data:{project_id:f.project.id,key:'art_direction_pipeline_enabled',value:'true'}});
 const wi=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:'old-writer',kind:'content_write',state:'claimed',assignee_role:'content_writer',input_context_version:2,lease_actor_id:f.args.actorId,lease_token:'synthetic-writer-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const original=art.isEnabled.bind(art);let arrived,resume;const atBoundary=new Promise(r=>{arrived=r}),continueWriter=new Promise(r=>{resume=r});
 art.isEnabled=async(...args)=>{const result=await original(...args);if(args[0]===f.project.id){arrived();await continueWriter;}return result;};
 const writer=f.rpc('ba_complete_work_item',{projectId:f.project.id,actorId:f.args.actorId,workItemId:wi.id,leaseToken:'synthetic-writer-lease',result:{body:'A newly written draft must not overwrite a committed frozen request.'},idempotencyKey:'old-writer-completion'}).then(value=>({value}),error=>({error}));
 try{await Promise.race([atBoundary,writer.then(()=>{throw Error('Writer did not reach canonical revision boundary');})]);const owner=f.call({});
 let observing=true;const blocked=async()=>{const deadline=Date.now()+2000;while(observing&&Date.now()<deadline){const rows=await db.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%') AS blocked`;if(rows[0].blocked)return;await new Promise(r=>setTimeout(r,10));}if(observing)throw Error('Owner neither completed nor waited on the canonical content lock');};
 await Promise.race([owner,blocked()]);observing=false;resume();const [ownerResult,writerResult]=await Promise.all([owner,writer]);const successes=Number(ownerResult.isError!==true)+Number(!writerResult.error);assert.equal(successes,1,'Only the old writer or the frozen request may commit, never both');
 const item=await db.contentItem.findUnique({where:{id:f.task.id}});if(ownerResult.isError!==true){assert.equal(item.draft_text,f.body);assert.equal(item.accepted_revision,2);}else{assert.equal(item.content_revision,3);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id,command:'ba_request_publication_visual_reassessment'}}),0);}}
 finally{resume();art.isEnabled=original;}
});
test('REL05 restored no-visual projections cannot bypass the durable request at actual browser release',async t=>{
 const f=await fixture(t),template=require('./shared-linkedin-text-only.fixture.cjs').textOnlyFixture();
 await db.socialChannel.update({where:{id:f.args.expectedChannelId},data:{name:template.f.state.task.channel.name,config:template.f.state.task.channel.config}});await db.contentItem.update({where:{id:f.task.id},data:{draft_text:template.body,publish_at:f.task.schedule_at,quality_report:template.f.state.task.quality_report}});f.args.expectedBodySha256=digest(template.body);
 const manifest=await require(path.join(base,'services/agent_workspace_manifest.service.js')).loadAgentWorkspaceManifest(f.project.id,f.user.id);
 const snapshot={...template.args.snapshot,projectId:f.project.id,taskId:f.task.id,channelId:f.args.expectedChannelId,contentRevision:2,bodySha256:digest(template.body),decisionId:f.decision.id,decisionVersion:1,scheduleAt:f.args.expectedScheduleAt,publishAt:f.args.expectedScheduleAt,manifestChecksum:manifest.checksum};
 const release={projectId:f.project.id,taskId:f.task.id,actorId:f.args.actorId,snapshot,approvalReference:'Synthetic historical exact package Owner release',idempotencyKey:'old-browser-release',apply:true};await f.rpc('ba_repair_browser_publication_metadata',{...release,idempotencyKey:'original-metadata'});
 const requested=await f.call({});assert.notEqual(requested.isError,true);
 // Isolated legacy projection restoration; immutable request/audit and new art WI remain untouched.
 await db.contentItem.update({where:{id:f.task.id},data:{status:'ready_for_execution',visual_mode:'auto_assess',visual_state:'NO_VISUAL_NEEDED',handoff_state:'ready'}});
 await assert.rejects(f.rpc('ba_release_browser_publication',release),/PUBLICATION_VISUAL_REVIEW_REQUIRED/);assert.equal(await db.workItem.count({where:{project_id:f.project.id,kind:'browser_publish'}}),0);assert.equal(await db.deliveryAttempt.count({where:{project_id:f.project.id}}),0);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id,command:'ba_request_publication_visual_reassessment'}}),1);
});

test('REL05 concurrent durable source replacement retains CAS denial and zero review writes',async t=>{
 const f=await fixture(t),applied=await f.call({});assert.notEqual(applied.isError,true);const generation=applied.value.binding.generation,artWorkId=applied.value.art_direction_work_item_id;
 await db.workItem.update({where:{id:artWorkId},data:{state:'claimed',lease_actor_id:f.args.actorId,lease_token:'synthetic-art-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const decision=await f.rpc('ba_submit_art_direction_decision',{projectId:f.project.id,workItemId:artWorkId,actorId:f.args.actorId,leaseToken:'synthetic-art-lease',idempotencyKey:'durable-race-decision',decision:{decision:'SOURCE_REQUIRED',source_content_revision:2,channel:'linkedin',placement:'feed',reason:'A meaningful source explains the mechanism',loss_without_visual:'The mechanism is hard to follow'}});
 const attached=await f.rpc('ba_attach_visual_source',{projectId:f.project.id,actorId:f.args.actorId,contentItemId:f.task.id,fileUrl:'https://example.invalid/initial-durable.png',provenance:{source:'synthetic-test'},altText:'Synthetic visual',decisionId:decision.decision_id,reassessmentGeneration:generation});
 const work=await db.workItem.findFirst({where:{project_id:f.project.id,content_item_id:f.task.id,kind:'visual_review'}});await db.workItem.update({where:{id:work.id},data:{state:'claimed',lease_actor_id:f.args.actorId,lease_token:'synthetic-review-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const review={projectId:f.project.id,actorId:f.args.actorId,assetId:attached.asset_id,decision:'approved',workItemId:work.id,leaseToken:'synthetic-review-lease',reassessmentGeneration:generation};
 const taskBefore=await db.contentItem.findUnique({where:{id:f.task.id}}),workBefore=await db.workItem.findUnique({where:{id:work.id}}),eventsBefore=await db.workflowEvent.count({where:{project_id:f.project.id}});
 const originalFind=db.imageAsset.findFirst.bind(db.imageAsset);let observed,unlock,locked;const observedRead=new Promise(r=>{observed=r}),unlockWriter=new Promise(r=>{unlock=r}),rowLocked=new Promise(r=>{locked=r});
 db.imageAsset.findFirst=async args=>{const row=await originalFind(args);observed();return row;};
 const concurrentWriter=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM planner.content_items WHERE id=${f.task.id} FOR UPDATE`;locked();await unlockWriter;return tx.imageAsset.update({where:{id:attached.asset_id},data:{file_url:'https://example.invalid/concurrent-durable.png'}});});
 try{await rowLocked;const pending=f.rpc('ba_review_image_asset',review);await observedRead;unlock();const committedAsset=await concurrentWriter;await assert.rejects(pending,error=>/VISUAL_REASSESSMENT_CAS_CONFLICT/.test(error.message)&&!error.message.includes('STORAGE_OR_PLACEMENT'));
 assert.deepEqual(await db.imageAsset.findUnique({where:{id:attached.asset_id}}),committedAsset);assert.equal(committedAsset.status,'candidate');assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),taskBefore);assert.deepEqual(await db.workItem.findUnique({where:{id:work.id}}),workBefore);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),eventsBefore);
 }finally{unlock();db.imageAsset.findFirst=originalFind;}
});
