const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {setup,deps,db,pool}=require('./browser-recovery.fixture.cjs'),{body,sha}=require('./shared-browser.fixture.cjs');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist',file=path.join(base,'services/browser_terminal_preparation_recovery.js');
const api=fs.existsSync(file)?require(file):{};
const release=require(path.join(base,'services/browser_publication_release.js')),execution=require(path.join(base,'services/browser_publication_execution.js'));
test.after(async()=>{await db.$disconnect();await pool.end()});
async function scenario(t){
 const s=await setup(t),r=await release.releaseBrowserPublication(s.args,deps),workItemId=r.browser_work_item_id;
 const claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps);
 const send={...s.args,workItemId,leaseToken:claim.lease_token,idempotencyKey:'original-send',apply:false};
 const started=await execution.startBrowserSubmission(send,deps),attemptId=started.attempt_id,now=Date.now();
 await db.workItem.update({where:{id:workItemId},data:{lease_expires_at:new Date(now-1000)}});
 const turnId=crypto.randomUUID(),threadId=crypto.randomUUID(),args=JSON.stringify({code:'var originalBrowser=await cua.getBrowser("synthetic-browser"); var originalTab=await originalBrowser.createBrowserTab("https://www.linkedin.com/company/97416172/admin/page-posts/published/"); await originalTab.getAXState();',title:'Read original profile'});
 const attempt=await db.deliveryAttempt.findUnique({where:{id:attemptId}}),nativeStarted=attempt.created_at.getTime()-1000;
 const principal={userId:s.user.id,actorId:s.args.actorId,projectId:s.project.id,profile:'owner'},publisher={...principal,profile:'publisher'};
 const scope={projectId:s.project.id,taskId:s.task.id,attemptId,expectedManifestChecksum:s.args.snapshot.manifestChecksum,idempotencyKey:'terminal-one'};
 const evidence={controlReference:`codex-control://local/thread/${threadId}/turn/${turnId}/call/command-synthetic`,archiveSha256:sha('synthetic-complete-archive'),
  collectorSha256:sha(fs.readFileSync('/source/ops/original-terminal-source/collect.cjs','utf8')),browserInstanceId:'synthetic-browser',
  observation:{schemaVersion:1,kind:'LOCAL_ARCHIVE_TERMINAL_OBSERVATION',threadId,turnId,start:{ordinal:1,timestamp:new Date(nativeStarted).toISOString()},end:{ordinal:10,timestamp:new Date(now).toISOString(),kind:'task_complete'},
   operations:[{callId:'call-original-read',ordinal:2,argumentsSha256:sha(args),status:'completed',terminalOrdinal:3,completedAtMs:nativeStarted+100}],custodyGranted:false,nativeQueueDrainProven:false,providerAbsenceProven:false,submissionPermitted:false},
  declarations:[{callId:'call-original-read',argumentsJson:args}],otherOperations:[],axBindings:[],
  originalStart:{callId:'original-start',ordinal:8,projectId:s.project.id,taskId:s.task.id,attemptId,workItemId,keySha256:sha(send.idempotencyKey),leaseSha256:sha(send.leaseToken),snapshotSha256:sha(JSON.stringify(s.args.snapshot))},
  providerWindow:{controlReference:`codex-control://local/thread/${threadId}/turn/${crypto.randomUUID()}/call/read-window`,profileUrl:s.args.snapshot.identity.profileUrl,providerAccountId:s.args.snapshot.identity.providerAccountId,accountType:s.args.snapshot.identity.accountType,
   startedAtMs:now-1000,observedAtMs:now,view:'PUBLISHED',order:'TIMESTAMP_DESC',filters:[],pinned:[],gaps:[],topBoundary:'OBSERVED',
   pages:[{sourceCallId:'native-window',ordinal:1,previousPageSha256:null,items:[{providerId:'old-native-post',earliestMs:nativeStarted-172800000,latestMs:nativeStarted-86400000,bodySha256:sha('unrelated previous post'),assetSha256:null}]}]}};
 const app=api.createTerminalPreparationRecovery?.({deps});
 return{...s,scope,send,attemptId,workItemId,evidence,principal,publisher,app};
}
const capture=s=>s.app.capture({...s.scope,evidence:s.evidence},s.principal);
async function recover(s){const c=await capture(s);return s.app.recover({...s.scope,evidenceId:c.evidence_id},s.principal)}
test('TERM-01 real same-attempt transaction consumes terminal evidence and queues pickup without worker ACK',async t=>{
 const s=await scenario(t);assert.equal(typeof api.createTerminalPreparationRecovery,'function');const r=await recover(s);assert.equal(r.resumed,true);assert.equal(r.generation,1);assert.equal(r.submission_permitted,false);
 const attempt=await db.deliveryAttempt.findUnique({where:{id:s.attemptId}});assert.equal(attempt.status,'pending');assert.equal(attempt.idempotency_key,s.send.idempotencyKey);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);
 const pickup=await s.app.pickup({...s.scope,generation:1},s.publisher);assert.equal(pickup.workItemId,s.workItemId);assert.notEqual(pickup.leaseToken,s.send.leaseToken);
 assert.equal((await db.workflowEvent.findFirst({where:{project_id:s.project.id,command:'browser_terminal_preparation_adopted'}})).after_state.evidence_class,'OWNER_VERIFIED_TERMINAL_OPERATIONS_V1');
});
test('TERM-02 exact recovery replay is read-only; conflicting or cross-role evidence cannot mint custody',async t=>{
 const s=await scenario(t),c=await capture(s),request={...s.scope,evidenceId:c.evidence_id};await s.app.recover(request,s.principal);
 const before=await db.workItem.findUnique({where:{id:s.workItemId}});assert.equal((await s.app.recover(request,s.principal)).replayed,true);assert.deepEqual(await db.workItem.findUnique({where:{id:s.workItemId}}),before);
 await assert.rejects(()=>s.app.capture({...s.scope,evidence:s.evidence},s.publisher),/TERMINAL_OWNER/);
});
test('TERM-03 any old permit or live old lease rejects adoption instead of resetting UNKNOWN',async t=>{
 const s=await scenario(t);await db.workflowEvent.create({data:{project_id:s.project.id,content_item_id:s.task.id,work_item_id:s.workItemId,actor_id:s.args.actorId,command:'ba_pre_submit_browser_submission',after_state:{submission_permitted:true}}});
 await assert.rejects(()=>recover(s),/POST_SUBMIT_UNKNOWN|TERMINAL_/);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.project.id}}),0);
});
test('TERM-04 source gaps, unsupported external writer, nonterminal action and arbitrary Post operation refuse',async t=>{
 const s=await scenario(t);for(const mutate of [e=>e.observation.operations[0].status='running',e=>e.observation.operations.push(e.observation.operations[0]),
  e=>e.otherOperations.push({callId:'outside',kind:'provider_writer',status:'completed',name:'unknown-native-send'}),e=>{e.declarations[0].argumentsJson=JSON.stringify({code:'await originalTab.playwright.getByRole("button",{name:"Post",exact:true}).click();'});e.observation.operations[0].argumentsSha256=sha(e.declarations[0].argumentsJson)}]){
  const e=structuredClone(s.evidence);mutate(e);await assert.rejects(()=>s.app.capture({...s.scope,evidence:e},s.principal),/TERMINAL_/);
 }assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'browser_terminal_execution_evidence'}}),0);
});
test('TERM-05 provider window must reach before original start with exact profile, no gap/pin/filter/duplicate',async t=>{
 const s=await scenario(t);for(const mutate of [e=>e.providerWindow.filters.push('unknown'),e=>e.providerWindow.gaps.push('unread-page'),e=>e.providerWindow.providerAccountId='foreign',
  e=>{e.providerWindow.pages[0].items[0].bodySha256=s.args.snapshot.bodySha256},e=>{e.providerWindow.pages[0].items[0].earliestMs=Date.now();e.providerWindow.pages[0].items[0].latestMs=Date.now()}]){
  const e=structuredClone(s.evidence);mutate(e);await assert.rejects(()=>s.app.capture({...s.scope,evidence:e},s.principal),/TERMINAL_/);
 }
});
test('TERM-06 old lease cannot obtain a permit; supported pickup/first-permit/dispatch/confirm completes one original attempt',async t=>{
 const s=await scenario(t);await recover(s);const p=await s.app.pickup({...s.scope,generation:1},s.publisher),observed={...s.send,attemptId:s.attemptId,leaseToken:p.leaseToken,
  observedProfileUrl:s.args.snapshot.identity.profileUrl,observedProviderAccountId:s.args.snapshot.identity.providerAccountId,observedAccountType:s.args.snapshot.identity.accountType,
  observedBodySha256:sha(body),observedAssetSha256:s.args.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(x=>sha(x.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:sha('native-current-editor')};
 await assert.rejects(()=>s.app.preSubmit({...observed,leaseToken:s.send.leaseToken},1,s.publisher));assert.equal((await s.app.preSubmit(observed,1,s.publisher)).submission_permitted,true);
 await s.app.beginDispatch(observed,1,s.publisher);await assert.rejects(()=>s.app.beginDispatch(observed,1,s.publisher));
 const {leaseToken,...confirm}=observed;await s.app.confirm({...confirm,publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:1930000001/',providerObjectId:'urn:li:share:1930000001',publishedAt:new Date().toISOString()},1,s.publisher);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'delivered');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),1);
});
test('TERM-07 turn ending before original start cannot prove terminal preparation',async t=>{
 const s=await scenario(t);s.evidence.observation.end.timestamp=new Date(s.evidence.observation.operations[0].completedAtMs+100).toISOString();
 await assert.rejects(()=>capture(s),/TERMINAL_SOURCE_CHRONOLOGY/);assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.project.id}}),0);
});
test('TERM-08 an unexpired original lease is never replaced',async t=>{
 const s=await scenario(t);await db.workItem.update({where:{id:s.workItemId},data:{lease_expires_at:new Date(Date.now()+60000)}});
 await assert.rejects(()=>recover(s),/LEGACY_BROWSER_ACTIVE_EXECUTOR|TERMINAL_/);
 assert.equal((await db.workItem.findUnique({where:{id:s.workItemId}})).lease_token,s.send.leaseToken);
});
test('TERM-09 concurrent consumers create one generation and preserve the original attempt',async t=>{
 const s=await scenario(t),c=await capture(s),request={...s.scope,evidenceId:c.evidence_id};
 const outcomes=await Promise.allSettled([s.app.recover(request,s.principal),s.app.recover({...request,idempotencyKey:'competing-consumer'},s.principal)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.project.id}}),1);
 assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'browser_terminal_preparation_adopted'}}),1);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);
});
test('TERM-10 failed durable audit rolls back lease, ledger and evidence consumption',async t=>{
 const s=await scenario(t),c=await capture(s),prior=await db.workItem.findUnique({where:{id:s.workItemId}});
 const failingDb=new Proxy(db,{get(target,key){if(key==='$transaction')return (run,opts)=>target.$transaction(tx=>run(new Proxy(tx,{get(inner,field){
  if(field==='workflowEvent')return new Proxy(inner.workflowEvent,{get(events,method){if(method==='create')return args=>{if(args.data.command==='browser_terminal_preparation_adopted')throw new Error('synthetic audit refusal');return events.create(args)};return events[method]}});
  return inner[field]}})),opts);return target[key]}});
 const failing=api.createTerminalPreparationRecovery({deps:{...deps,db:failingDb}});
 await assert.rejects(()=>failing.recover({...s.scope,evidenceId:c.evidence_id},s.principal),/synthetic audit refusal/);
 assert.deepEqual(await db.workItem.findUnique({where:{id:s.workItemId}}),prior);
 assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.project.id}}),0);
 assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.project.id}}),0);
 assert.equal((await s.app.recover({...s.scope,evidenceId:c.evidence_id},s.principal)).resumed,true);
});
test('TERM-11 unsupported source programs and malformed syntax cannot become absence authority',async t=>{
 const s=await scenario(t);for(const code of ['await originalTab.getAXState();',
  'var originalBrowser=await cua.getBrowser("synthetic-browser"); setTimeout(()=>originalTab.click(1),0);',
  'var originalBrowser=await cua.getBrowser("synthetic-browser"); var unfinished = ;',
  'var originalBrowser=await cua.getBrowser("synthetic-browser"); void originalBrowser.createBrowserTab("https://www.linkedin.com/");']){
  const e=structuredClone(s.evidence);e.declarations[0].argumentsJson=JSON.stringify({code});e.observation.operations[0].argumentsSha256=sha(e.declarations[0].argumentsJson);
  await assert.rejects(()=>s.app.capture({...s.scope,evidence:e},s.principal),/TERMINAL_/);
 }assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'browser_terminal_execution_evidence'}}),0);
});
test('TERM-12 scoped principal and fresh evidence are required even after valid intake',async t=>{
 const s=await scenario(t);await assert.rejects(()=>s.app.capture({...s.scope,evidence:s.evidence},{...s.principal,projectId:s.project.id+1}),/TERMINAL_OWNER/);
 const c=await capture(s),request={...s.scope,evidenceId:c.evidence_id};
 await assert.rejects(()=>s.app.recover(request,s.publisher),/TERMINAL_OWNER/);
 const late=api.createTerminalPreparationRecovery({deps,clock:()=>Date.now()+181000});await assert.rejects(()=>late.recover(request,s.principal),/TERMINAL_EVIDENCE_STALE/);
 assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.project.id}}),0);
});
test('TERM-13 authenticated MCP separates Owner recovery from Publisher same-attempt pickup',async t=>{
 const s=await scenario(t),c=await capture(s),toolFile=path.join(base,'mcp/tools/browser_terminal_preparation_tools.js');
 assert.equal(fs.existsSync(toolFile),true,'terminal MCP boundary must exist');
 const {registerTerminalPreparationTools:register}=require(toolFile),{McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 async function connect(principal){const server=new McpServer({name:'terminal-synthetic',version:'1'}),client=new Client({name:'terminal-test',version:'1'});register(server,s.app,principal);const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const receive=a.onmessage;const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));a.onmessage=message=>withPublicationPrincipal(principal,()=>receive?.(message));await client.connect(b);t.after(()=>client.close());return{server,client};}
 const owner=await connect(s.principal),publisher=await connect(s.publisher),anonymous=await connect(null);
 const unscoped=await connect({...s.publisher,projectId:undefined});assert.equal(Object.keys(unscoped.server._registeredTools).length,0);
 assert.equal(Object.keys(owner.server._registeredTools).includes('ba_pickup_terminal_browser_preparation'),false);assert.equal(Object.keys(owner.server._registeredTools).includes('ba_begin_terminal_browser_dispatch'),false);
 assert.equal(Object.keys(anonymous.server._registeredTools).length,0);await assert.rejects(()=>anonymous.client.listTools(),error=>error.code===-32601);
 assert.equal((await publisher.client.listTools()).tools.some(x=>x.name==='ba_recover_terminal_browser_preparation'),false);
 const result=await owner.client.callTool({name:'ba_recover_terminal_browser_preparation',arguments:{...s.scope,evidenceId:c.evidence_id}});
 assert.equal(result.isError,false);
 const pickup=await publisher.client.callTool({name:'ba_pickup_terminal_browser_preparation',arguments:{...s.scope,generation:1}});assert.equal(pickup.isError,false);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);
 const foreign=await publisher.client.callTool({name:'ba_pickup_terminal_browser_preparation',arguments:{...s.scope,projectId:s.project.id+1,generation:1}});assert.equal(foreign.isError,true);
});
test('TERM-14 standard MCP preSubmit and confirm route adopted custody without caller-controlled generation',async t=>{
 const s=await scenario(t);await recover(s);
 const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 const server=new McpServer({name:'terminal-route',version:'1'}),client=new Client({name:'terminal-route-test',version:'1'});
 require(path.join(base,'mcp/tools/browser_publication_tools.js')).registerBrowserPublicationTools(server,undefined,undefined,undefined,s.app,s.publisher);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const receive=a.onmessage;const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));a.onmessage=message=>withPublicationPrincipal(s.publisher,()=>receive?.(message));await client.connect(b);t.after(()=>client.close());
 const call=(name,args)=>client.callTool({name,arguments:args}),pickup=await call('ba_pickup_terminal_browser_preparation',{...s.scope,generation:1});assert.equal(pickup.isError,false);
 const p=JSON.parse(pickup.content.find(x=>x.type==='text').text);assert.equal(p.idempotencyKey,s.send.idempotencyKey);
 const observed={...s.send,attemptId:p.attemptId,idempotencyKey:p.idempotencyKey,leaseToken:p.leaseToken,
  observedProfileUrl:s.args.snapshot.identity.profileUrl,observedProviderAccountId:s.args.snapshot.identity.providerAccountId,observedAccountType:s.args.snapshot.identity.accountType,
  observedBodySha256:sha(body),observedAssetSha256:s.args.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(x=>sha(x.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:sha('native-current-editor')};
 assert.equal((await call('ba_pre_submit_browser_submission',{...observed,leaseToken:s.send.leaseToken})).isError,true);
 assert.equal((await call('ba_pre_submit_browser_submission',observed)).isError,false);
 assert.equal((await call('ba_begin_terminal_browser_dispatch',{...observed,generation:1})).isError,false);
 const confirmation={...observed,publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:1930000002/',providerObjectId:'urn:li:share:1930000002',publishedAt:new Date().toISOString()};
 assert.equal((await call('ba_confirm_browser_submission',{...confirmation,leaseToken:s.send.leaseToken})).isError,true);
 assert.equal((await call('ba_confirm_browser_submission',confirmation)).isError,false);
 const replay=await call('ba_confirm_browser_submission',confirmation);assert.equal(replay.isError,false);assert.equal(JSON.parse(replay.content.find(x=>x.type==='text').text).replayed,true);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),1);
});
function reviewedRequest(s,issued){
 const metadata=structuredClone(s.evidence);delete metadata.declarations;delete metadata.otherOperations;delete metadata.axBindings;
 const {classifyExternalExec,canonicalArgumentsSha256}=require('/source/ops/terminal-external-census-20261026/census.cjs'),rawInput=`text(await tools.mcp__synthetic_planner__ba_start_browser_submission(${JSON.stringify(s.send)}));`;
 const leaf={callId:metadata.originalStart.callId,ordinal:metadata.originalStart.ordinal,server:'synthetic_planner',tool:'ba_start_browser_submission',status:'completed',argumentsSha256:canonicalArgumentsSha256(s.send),parentCallId:'source-frame',resultAttemptId:s.attemptId,resultSubmissionPermitted:false,resultRetryAllowed:false};
 const semantic=classifyExternalExec({callId:'source-frame',ordinal:4,namespace:null,toolName:'exec',rawInput,completion:{callId:'source-frame',ordinal:9,status:'completed'},nativeBindings:[leaf]},{...issued.target_binding,plannerServer:'synthetic_planner'});
 assert.equal(semantic.classification,'TARGET_START_ONLY');
 const b=issued.target_binding,native={...metadata.observation,kind:'LOCAL_TERMINAL_SEMANTICS_OBSERVATION',operations:metadata.observation.operations.map(op=>({...op,classification:'SUPPORTED_READ_ONLY',shapes:[]})),
  external:[{callId:'source-frame',ordinal:4,argumentsSha256:sha(rawInput),transportSha256:sha(JSON.stringify([null,'exec'])),classification:'UNREVIEWED_EXTERNAL_TRANSPORT',shapes:[],matchingOutput:{ordinal:9,outputSha256:sha('synthetic final exec envelope')},completionOrdinal:9,semantic}],
  originalStartBinding:{callId:leaf.callId,ordinal:leaf.ordinal,projectId:b.projectId,taskId:b.taskId,attemptId:b.attemptId,workItemId:b.workItemId,keySha256:b.keySha256,leaseSha256:b.leaseSha256,approvalSha256:b.approvalSha256,canonicalSnapshotSha256:b.snapshotSha256,publisherActorSha256:sha(b.actorId)},unaccountedNativeCallIds:[],nativeWireKinds:[],
  recordsSha256:sha('synthetic-normalized-native-records'),programHashes:issued.program_hashes,profileSha256:sha('https://www.linkedin.com/company/'+s.args.snapshot.identity.providerAccountId+'/admin/page-posts/published/'),browserSha256:sha(metadata.browserInstanceId)};
 const nativeJson=JSON.stringify(native)+'\n',reference=`codex-control://local/thread/${crypto.randomUUID()}/turn/${crypto.randomUUID()}/call/synthetic-independent-owner-review`;
 return {...s.scope,reviewId:issued.review_id,nonce:issued.nonce,evidence:metadata,localObservationJson:nativeJson,
  sourceControl:{controlReference:reference,outputSha256:sha(nativeJson),reviewedAtMs:Date.now()},providerControl:{controlReference:metadata.providerWindow.controlReference,evidenceSha256:sha(JSON.stringify(metadata.providerWindow)),reviewedAtMs:Date.now()}};
}
test('TERM-15 Owner safe intake binds native local output to one fresh review and rejects Publisher/altered producer',async t=>{
 const s=await scenario(t);assert.equal(typeof s.app.issueReview,'function');
 await assert.rejects(()=>s.app.issueReview(s.scope,s.publisher),/TERMINAL_OWNER/);
 const issued=await s.app.issueReview(s.scope,s.principal),request=reviewedRequest(s,issued);
 await assert.rejects(()=>s.app.acceptReviewed(request,s.publisher),/TERMINAL_OWNER/);
 const altered=structuredClone(request),bad=JSON.parse(altered.localObservationJson);bad.programHashes.semantics=sha('foreign-unreviewed-code');altered.localObservationJson=JSON.stringify(bad)+'\n';altered.sourceControl.outputSha256=sha(altered.localObservationJson);
 await assert.rejects(()=>s.app.acceptReviewed(altered,s.principal),/TERMINAL_/);
 const c=await s.app.acceptReviewed(request,s.principal);assert.ok(c.evidence_id);assert.equal((await s.app.recover({...s.scope,evidenceId:c.evidence_id},s.principal)).resumed,true);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);
});
test('TERM-16 source review replay does not mint a fresh nonce or reset its three-review deadline',async t=>{
 const s=await scenario(t),first=await s.app.issueReview(s.scope,s.principal),replay=await s.app.issueReview(s.scope,s.principal);
 assert.equal(replay.review_id,first.review_id);assert.equal(replay.nonce,undefined);assert.equal(replay.replayed,true);
 for(let i=2;i<=3;i++){const next=await s.app.issueReview({...s.scope,idempotencyKey:'review-round-'+i},s.principal);assert.equal(next.deadline_at,first.deadline_at);}
 await assert.rejects(()=>s.app.issueReview({...s.scope,idempotencyKey:'review-round-4'},s.principal),/TERMINAL_REVIEW_BUDGET_EXHAUSTED/);
 assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'browser_terminal_evidence_review_requested'}}),3);assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.project.id}}),0);
});
test('TERM-17 wrong nonce, unsupported external execution, same-Publisher control and forged output reject before custody',async t=>{
 const s=await scenario(t),issued=await s.app.issueReview(s.scope,s.principal),request=reviewedRequest(s,issued);
 for(const mutate of [r=>r.nonce=crypto.randomUUID(),r=>r.sourceControl.outputSha256=sha('forged'),r=>r.sourceControl.controlReference=r.evidence.controlReference,
  r=>{const local=JSON.parse(r.localObservationJson);local.external.push({callId:'unreviewed-exec',classification:'UNREVIEWED_EXTERNAL_TRANSPORT'});r.localObservationJson=JSON.stringify(local)+'\n';r.sourceControl.outputSha256=sha(r.localObservationJson)}]){
  const r=structuredClone(request);mutate(r);await assert.rejects(()=>s.app.acceptReviewed(r,s.principal),/TERMINAL_/);
 }
 assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'browser_terminal_execution_evidence'}}),0);
 assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.project.id}}),0);assert.equal((await db.workItem.findUnique({where:{id:s.workItemId}})).lease_token,s.send.leaseToken);
});
test('TERM-18 a different authorized Owner cannot replace the original Publisher identity during transfer',async t=>{
 const s=await scenario(t),other=await db.user.create({data:{email:`owner-control-${crypto.randomUUID()}@example.invalid`,name:'Synthetic independent Owner',password_hash:'not-a-login'}});
 t.after(()=>db.user.delete({where:{id:other.id}}));await db.projectMember.create({data:{project_id:s.project.id,user_id:other.id,role:'owner'}});
 const owner={userId:other.id,actorId:`user:${other.id}`,projectId:s.project.id,profile:'owner'},c=await s.app.capture({...s.scope,evidence:s.evidence},owner);
 await s.app.recover({...s.scope,evidenceId:c.evidence_id},owner);
 assert.equal((await db.workItem.findUnique({where:{id:s.workItemId}})).lease_actor_id,s.publisher.actorId);
 await assert.rejects(()=>s.app.pickup({...s.scope,generation:1},{...owner,profile:'publisher'}));
 assert.equal((await s.app.pickup({...s.scope,generation:1},s.publisher)).workItemId,s.workItemId);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),1);
});
