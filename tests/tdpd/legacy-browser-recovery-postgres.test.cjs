const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {setup,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const {body,sha}=require('./shared-browser.fixture.cjs');
const release=require(path.join(base,'services/browser_publication_release.js'));
const execution=require(path.join(base,'services/browser_publication_execution.js'));
const {createLegacyBrowserRecovery}=require(path.join(base,'services/legacy_browser_recovery.js'));
const {createPreparationRecovery}=require(path.join(base,'services/browser_preparation_recovery.js'));
process.env.BROWSER_RECOVERY_V2_ENABLED='true';
test.after(async()=>{await db.$disconnect();await pool.end();});
async function scenario(t,overrides={}){
 const s=await setup(t,'setka'),r=await release.releaseBrowserPublication(s.args,deps),workItemId=r.browser_work_item_id;
 const claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps);
 const send={...s.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'original-attempt'};
 const start=await execution.startBrowserSubmission(send,deps),attemptId=start.attempt_id;
 await db.workItem.update({where:{id:workItemId},data:{lease_expires_at:new Date(Date.now()-86400000)}});
 let quiesced=0,reads=0;
 const supervisor={executorId:'synthetic-legacy-supervisor',supports:()=>true,
  quiesce:async a=>({executorId:'synthetic-legacy-supervisor',generation:a.generation,challengeSha256:sha(a.challenge),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'c'.repeat(64),failureKind:'EXECUTOR_RESTART'}),
  fenceLegacy:async a=>{quiesced++;return {version:1,projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,workItemId:a.workItemId,executorId:'synthetic-legacy-supervisor',packageSha256:a.packageSha256,approvalSha256:a.approvalSha256,oldLeaseSha256:a.oldLeaseSha256,challengeSha256:sha(a.challenge),lifecycleCoverage:'complete',oldExecutorQuiescent:true,issuedPermitCount:0,dispatchCount:0,evidenceRef:'sha256:'+'c'.repeat(64)};}};
 const reader={supports:()=>true,read:async(a,control)=>{reads++;assert.equal(await control.takeRequest(),true);return {kind:'ABSENT',version:1,projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,packageSha256:a.packageSha256,accountSha256:sha(JSON.stringify(a.snapshot.identity)),challengeSha256:sha(a.challenge),observedAtMs:Date.now(),coverage:'complete',duplicateAbsent:true,evidenceRef:'sha256:'+'d'.repeat(64)};}};
 const options={deps,supervisor,reader,...overrides},service=createLegacyBrowserRecovery(options);
 const request={projectId:s.args.projectId,taskId:s.args.taskId,attemptId,actorId:s.args.actorId,idempotencyKey:'historical-adoption'};
 const observation={...send,attemptId,observedProfileUrl:s.args.snapshot.identity.profileUrl,observedProviderAccountId:s.args.snapshot.identity.providerAccountId,observedAccountType:'personal',observedBodySha256:sha(body),observedAssetSha256:s.args.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
 return {...s,send,attemptId,request,observation,supervisor,reader,options,service,quiesced:()=>quiesced,reads:()=>reads};
}
const custody=s=>db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.args.projectId,attempt_id:s.attemptId}}});
test('L01 preview is no-write and distinguishes missing legacy custody/runtime',async t=>{
 const s=await scenario(t),events=await db.workflowEvent.count({where:{project_id:s.args.projectId}});
 const result=await s.service.preview(s.request);assert.equal(result.code,'LEGACY_BROWSER_VERIFICATION_REQUIRED');assert.equal(result.submission_permitted,false);assert.equal(result.retry_allowed,false);assert.equal(s.quiesced(),0);assert.equal(s.reads(),0);assert.equal(await custody(s),null);assert.equal(await db.workflowEvent.count({where:{project_id:s.args.projectId}}),events);
 const unavailable=await createLegacyBrowserRecovery({deps}).preview(s.request);assert.equal(unavailable.code,'LEGACY_BROWSER_SUPERVISOR_UNAVAILABLE');assert.ok(unavailable.action);
});
test('L02 complete pre-permit custody resumes same attempt, replay and old writer fences',async t=>{
 const s=await scenario(t),result=await s.service.adopt(s.request);assert.equal(result.code,'RECOVERY_PREPARE_RESUMED');assert.equal(result.resumed,true);assert.equal(result.generation,1);assert.equal(result.submission_permitted,false);assert.equal(result.retry_allowed,false);
 const again=await createLegacyBrowserRecovery(s.options).adopt(s.request);assert.equal(again.replayed,true);assert.equal(s.quiesced(),1);assert.equal(s.reads(),1);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.args.taskId}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.args.taskId}}),0);
 assert.equal(await db.workflowEvent.count({where:{project_id:s.args.projectId,command:'ba_pre_submit_browser_submission'}}),0);
 const preparation=createPreparationRecovery({deps,supervisor:s.supervisor});
 const pickup=await preparation.pickup({...s.request,generation:1});assert.notEqual(pickup.leaseToken,s.send.leaseToken);assert.equal(JSON.stringify(result).includes(pickup.leaseToken),false);
 await assert.rejects(execution.preSubmitBrowserSubmission(s.observation,deps),/BROWSER_RECOVERY_V2_HELD/);
 await assert.rejects(preparation.preSubmit(s.observation,0),/RECOVERY_CONFLICT/);
 assert.equal((await preparation.preSubmit({...s.observation,leaseToken:pickup.leaseToken},1)).submission_permitted,true);
 assert.equal((await s.service.adopt({...s.request,idempotencyKey:'after-permit'})).resumed,false);
 let sent=0;const observed={...s.observation,leaseToken:pickup.leaseToken};await preparation.dispatch(observed,1,async()=>{sent++;});
 await assert.rejects(preparation.dispatch(observed,1,async()=>{sent++;}),/POST_SUBMIT_UNKNOWN/);assert.equal(sent,1);
 const {leaseToken,...confirmation}=observed;
 await preparation.confirm({...confirmation,publicUrl:'https://setka.ru/posts/019c0000-0000-7000-8000-000000000002',providerObjectId:'019c0000-0000-7000-8000-000000000002',publishedAt:new Date().toISOString()},1);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.args.taskId}}),1);assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'delivered');
});
test('L03 an existing exact native object is finalized atomically, with read-only replay',async t=>{
 const s=await scenario(t);s.reader.read=async(_a,c)=>{await c.takeRequest();const {leaseToken,...confirmation}=s.observation;return{kind:'FOUND',confirmation:{...confirmation,publicUrl:'https://setka.ru/posts/019c0000-0000-7000-8000-000000000003',providerObjectId:'019c0000-0000-7000-8000-000000000003',publishedAt:new Date().toISOString()}};};
 const result=await s.service.adopt(s.request);assert.equal(result.code,'RECONCILIATION_FOUND');assert.equal(result.submission_permitted,false);assert.equal(result.resumed,false);
 const fact=await db.publicationFact.findUnique({where:{content_item_id:s.args.taskId}});assert.ok(fact);const events=await db.workflowEvent.count({where:{project_id:s.args.projectId}});
 const again=await s.service.adopt(s.request);assert.equal(again.code,'RECONCILIATION_FOUND');assert.equal(again.replayed,true);assert.equal(again.publication_fact_id,fact.id);assert.equal(await db.workflowEvent.count({where:{project_id:s.args.projectId}}),events);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);
});
test('L04 issued permission excludes adoption before any external call',async t=>{
 const s=await scenario(t);await db.workflowEvent.create({data:{project_id:s.args.projectId,content_item_id:s.args.taskId,work_item_id:s.send.workItemId,actor_id:s.args.actorId,command:'ba_pre_submit_browser_submission',after_state:{submission_permitted:true,attempt_id:s.attemptId}}});
 const result=await s.service.adopt(s.request);assert.equal(result.code,'POST_SUBMIT_UNKNOWN');assert.equal(result.resumed,false);assert.equal(s.quiesced(),0);assert.equal(s.reads(),0);assert.equal(await custody(s),null);
});
test('L05 wrong challenge or incomplete reader remains UNKNOWN and never creates pickup',async t=>{
 for(const kind of ['proof','reader']){const s=await scenario(t);
  if(kind==='proof'){const original=s.supervisor.fenceLegacy;s.supervisor.fenceLegacy=async a=>({...await original(a),challengeSha256:'f'.repeat(64)});}
  else s.reader.read=async(_a,c)=>{await c.takeRequest();return{kind:'COVERAGE_INCOMPLETE'};};
  const result=await s.service.adopt(s.request);assert.equal(result.resumed,false);assert.equal(result.code,kind==='proof'?'PRE_DISPATCH_PROOF_UNAVAILABLE':'RECONCILIATION_COVERAGE_INCOMPLETE');assert.ok(result.message);assert.ok(result.action);
  assert.equal((await custody(s)).delivery_certainty,'UNKNOWN');assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);
 }
});
test('L06 simultaneous adopters cannot create two generations or readers',async t=>{
 const s=await scenario(t),results=await Promise.all([s.service.adopt(s.request),s.service.adopt({...s.request,idempotencyKey:'racing-adopter'})]);assert.ok(results.some(r=>r.resumed));assert.equal((await custody(s)).execution_generation,1);assert.equal(s.reads(),1);assert.equal(await db.workflowEvent.count({where:{project_id:s.args.projectId,command:'legacy_browser_preparation_adopted'}}),1);
});
test('L07 authorization and tenant failures do not reserve or invoke capabilities',async t=>{
 const s=await scenario(t);for(const change of [{actorId:'user:999999999'},{projectId:s.args.projectId+99999999}]){const result=await s.service.adopt({...s.request,...change});assert.equal(result.resumed,false);assert.equal(s.quiesced(),0);assert.equal(s.reads(),0);}assert.equal(await custody(s),null);
});
test('L07 demo Owner cannot adopt or pick up an already resumed generation',async t=>{
 const s=await scenario(t);await db.user.update({where:{id:s.user.id},data:{is_demo:true}});
 const denied=await s.service.adopt(s.request);assert.equal(denied.code,'PERMISSION_DENIED');assert.equal(s.quiesced(),0);assert.equal(await custody(s),null);
 await db.user.update({where:{id:s.user.id},data:{is_demo:false}});assert.equal((await s.service.adopt(s.request)).resumed,true);
 await db.user.update({where:{id:s.user.id},data:{is_demo:true}});
 await assert.rejects(createPreparationRecovery({deps,supervisor:s.supervisor}).pickup({...s.request,generation:1}),/OWNER_REQUIRED/);
});
test('L04 active executor and additional history are explicit pre-read blockers',async t=>{
 const s=await scenario(t);await db.workItem.update({where:{id:s.send.workItemId},data:{lease_expires_at:new Date(Date.now()+60000)}});
 assert.equal((await s.service.adopt(s.request)).code,'LEGACY_BROWSER_ACTIVE_EXECUTOR');assert.equal(s.quiesced(),0);assert.equal(await custody(s),null);
 await db.workItem.update({where:{id:s.send.workItemId},data:{lease_expires_at:new Date(0)}});
 await db.workflowEvent.create({data:{project_id:s.args.projectId,content_item_id:s.args.taskId,work_item_id:s.send.workItemId,actor_id:s.args.actorId,command:'x_native_issue_challenge',after_state:{submission_permitted:false}}});
 assert.equal((await s.service.adopt(s.request)).code,'POST_SUBMIT_UNKNOWN');assert.equal(s.reads(),0);
});
test('L05 uncounted or stale/wrong-account absence cannot establish no dispatch',async t=>{
 for(const variant of ['uncounted','stale','account']){const s=await scenario(t),original=s.reader.read;s.reader.read=async(a,c)=>{
  if(variant==='uncounted')return{kind:'ABSENT'};const value=await original(a,c);if(variant==='stale')value.observedAtMs=Date.now()-86400000;else value.accountSha256='f'.repeat(64);return value;};
  const result=await s.service.adopt(s.request);assert.equal(result.code,'RECONCILIATION_COVERAGE_INCOMPLETE');assert.equal(result.resumed,false);assert.equal((await custody(s)).delivery_certainty,'UNKNOWN');assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);
 }
});
test('L10 real MCP boundary is hidden by default and preserves profile/principal restrictions',async t=>{
 const s=await scenario(t),{McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 const register=require(path.join(base,'mcp/tools/legacy_browser_recovery_tools.js')).registerLegacyBrowserRecoveryTools;
 const empty=new McpServer({name:'unavailable',version:'1'});register(empty,createLegacyBrowserRecovery({deps}));assert.deepEqual(Object.keys(empty._registeredTools),['ba_preview_browser_preparation_recovery']);
 const server=new McpServer({name:'legacy-recovery',version:'1'}),client=new Client({name:'sole-publisher',version:'1'});register(server,s.service);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const result=await client.callTool({name:'ba_preview_browser_preparation_recovery',arguments:s.request}),text=JSON.stringify(result);assert.ok(text.includes('LEGACY_BROWSER_VERIFICATION_REQUIRED'));assert.ok(text.includes('action'));assert.equal(text.includes(s.send.leaseToken),false);assert.equal(text.includes(body),false);assert.equal(s.reads(),0);}
 finally{await client.close();await server.close();await empty.close();}
 const {isToolAllowedForProfile}=require(path.join(base,'mcp/capabilities.js')),{scopeRemoteMcpRequest}=require(path.join(base,'mcp/remote-auth.js'));
 for(const name of ['ba_preview_browser_preparation_recovery','ba_adopt_browser_preparation_recovery']){assert.equal(isToolAllowedForProfile('publisher',name),true);for(const role of ['writer','editor','planner','art_director'])assert.equal(isToolAllowedForProfile(role,name),false);
  const scoped=scopeRemoteMcpRequest({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...s.request,actorId:'user:999999999'}}},{userId:s.user.id,actorId:s.args.actorId,projectId:s.args.projectId,profile:'publisher'});assert.equal(scoped.allowed,true);assert.equal(scoped.body.params.arguments.actorId,s.args.actorId);
 }
 const invalid=await s.service.adopt({...s.request,oldExecutorQuiescent:true});assert.equal(invalid.resumed,false);assert.equal(s.quiesced(),0);assert.equal(await custody(s),null);
});
test('L07 package change during reader is rejected before adoption and lease rotation',async t=>{
 const s=await scenario(t),original=s.reader.read;s.reader.read=async(a,c)=>{const result=await original(a,c);await db.contentItem.update({where:{id:s.args.taskId},data:{draft_text:body+' changed'}});return result;};
 const result=await s.service.adopt(s.request);assert.equal(result.resumed,false);assert.equal(result.code,'PACKAGE_CHANGED');assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);assert.equal((await db.workItem.findUnique({where:{id:s.send.workItemId}})).lease_token,s.send.leaseToken);
});
test('L08 new keys cannot reset failed read budget after process restart',async t=>{
 const s=await scenario(t);s.reader.read=async(_a,c)=>{for(let i=0;i<25;i++)await c.takeRequest();return{kind:'TEMPORARY_UNAVAILABLE'};};
 const first=await s.service.adopt(s.request);assert.equal(first.resumed,false);const before=await custody(s);assert.equal(before.requests_used,20);
 const again=await createLegacyBrowserRecovery(s.options).adopt({...s.request,idempotencyKey:'new-key'});assert.equal(again.resumed,false);assert.equal(again.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal((await custody(s)).started_at.getTime(),before.started_at.getTime());
});
test('L08 expired durable deadline and late quiescence never admit preparation',async t=>{
 const s=await scenario(t);let current=Date.now(),aborted=false;
 const clock={now:()=>current,wait:async()=>undefined,timer:(ms,cb)=>{const id=setTimeout(()=>{current+=ms;cb();},5);return()=>clearTimeout(id);}};
 s.supervisor.fenceLegacy=async a=>new Promise(resolve=>a.signal.addEventListener('abort',()=>{aborted=true;resolve({version:1});},{once:true}));
 const result=await createLegacyBrowserRecovery({...s.options,clock}).adopt(s.request);assert.equal(result.resumed,false);assert.equal(aborted,true);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);
 const before=await custody(s);current=before.deadline_at.getTime()+1;
 const after=await createLegacyBrowserRecovery({...s.options,clock}).adopt({...s.request,idempotencyKey:'after-expiry'});assert.equal(after.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal((await custody(s)).deadline_at.getTime(),before.deadline_at.getTime());
});
test('L07 permission or approval denial stays condition-specific and preserves history',async t=>{
 for(const kind of ['PERMISSION_DENIED','APPROVAL_REVOKED']){const s=await scenario(t);s.reader.read=async(_a,c)=>{await c.takeRequest();return {kind};};
  const result=await s.service.adopt(s.request);assert.equal(result.code,kind);assert.ok(result.action);assert.equal(result.resumed,false);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.args.taskId}}),1);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);
 }
});
test('L06 a late old permission or changed lease is rejected inside final adoption',async t=>{
 for(const variant of ['permission','lease']){const s=await scenario(t),read=s.reader.read;s.reader.read=async(a,c)=>{const result=await read(a,c);
  if(variant==='permission')await db.workflowEvent.create({data:{project_id:s.args.projectId,content_item_id:s.args.taskId,work_item_id:s.send.workItemId,actor_id:s.args.actorId,command:'legacy_pre_submit_from_unaware_writer',after_state:{submission_permitted:true}}});
  else await db.workItem.update({where:{id:s.send.workItemId},data:{lease_expires_at:new Date(Date.now()+60000)}});return result;};
  const result=await s.service.adopt(s.request);assert.equal(result.resumed,false);assert.equal(result.code,variant==='permission'?'POST_SUBMIT_UNKNOWN':'RECOVERY_CONFLICT');assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);assert.equal((await custody(s)).delivery_certainty,'UNKNOWN');assert.equal((await custody(s)).cause_code,result.code);
 }
});
test('L09 adoption audit failure rolls back proof, preparation and lease changes',async t=>{
 const s=await scenario(t),failing={...deps,db:new Proxy(db,{get(target,key){if(key==='$transaction')return(run,options)=>target.$transaction(tx=>run(new Proxy(tx,{get(t,k){if(k==='workflowEvent')return {...t.workflowEvent,create:async a=>{if(a.data.command==='legacy_browser_preparation_adopted')throw Error('synthetic-audit-failure');return t.workflowEvent.create(a);}};return t[k];}})),options);return target[key];}})};
 const result=await createLegacyBrowserRecovery({...s.options,deps:failing}).adopt(s.request);assert.equal(result.resumed,false);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);assert.equal((await custody(s)).delivery_certainty,'UNKNOWN');assert.equal((await db.workItem.findUnique({where:{id:s.send.workItemId}})).lease_token,s.send.leaseToken);
});
