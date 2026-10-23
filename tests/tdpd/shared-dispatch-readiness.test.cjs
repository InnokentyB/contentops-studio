const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
assert.ok(base==='/opt/planner/dist'||base.startsWith('/results/'));
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {registerTaskPublicationTools}=require(path.join(base,'mcp/tools/task_publication_tools.js'));
const {registerBrowserPublicationTools}=require(path.join(base,'mcp/tools/browser_publication_tools.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const generic=require(path.join(base,'services/threads_generic_release.service.js')).default;
const legacy=require(path.join(base,'services/threads_task_publication.service.js')).default;
const owned=require(path.join(base,'services/publication_owned_route.js'));
const {prisma:db,pool}=require(path.join(base,'db.js'));
const principal={userId:29,actorId:'user:29',projectId:19,profile:'publisher'};
const envelope={projectId:19,taskId:87001,dryRun:true,approvalReference:'synthetic-exact-approval',expectedManifestChecksum:'sha256:'+'b'.repeat(64),releaseIdempotencyKey:'synthetic-release',idempotencyKey:'synthetic-send'};
async function clientFor(register,run){
 const server=new McpServer({name:'synthetic-dispatch',version:'1'});register(server);
 const client=new Client({name:'synthetic-operator',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);return await run(client);}finally{await client.close();await server.close();}
}
function payload(result){return result.structuredContent||JSON.parse(result.content[0].text);}
function routeMocks(t,errorCode){
 const calls=[];
 t.mock.method(legacy,'isThreadsTask',async()=>true);
 t.mock.method(legacy,'execute',async()=>{calls.push('legacy');throw Error('[THREADS_TASK_SCOPE_MISMATCH] private-provider-secret');});
 t.mock.method(owned,'tryOwnedPublicationTask',async()=>null);
 t.mock.method(generic,'publish',async(args,signal)=>{calls.push({args,signal});if(errorCode)throw Error('['+errorCode+'] private-provider-secret');return{mode:'dry_run',live_publish_supported:true,route_executable:true,published:false};});
 return calls;
}
for(const command of ['ba_publish_publication_task','ba_publish_threads_task'])test(command+' uses exact generic release for arbitrary tasks',async t=>{
 const calls=routeMocks(t);
 await clientFor(registerTaskPublicationTools,async client=>{
  const result=await withPublicationPrincipal(principal,()=>client.callTool({name:command,arguments:envelope}));
  assert.notEqual(result.isError,true);assert.equal(payload(result).published,false);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].args,{...envelope,actorId:principal.actorId});
  assert.ok(calls[0].signal instanceof AbortSignal);
 });
});
for(const command of ['ba_publish_publication_task','ba_publish_threads_task'])test(command+' lists missing exact release fields without legacy fallback',async t=>{
 const calls=routeMocks(t);
 await clientFor(registerTaskPublicationTools,async client=>{
  const result=await withPublicationPrincipal(principal,()=>client.callTool({name:command,arguments:{projectId:19,taskId:87001,dryRun:true}}));
  assert.equal(result.isError,true);const d=payload(result);
  assert.equal(d.code,'THREADS_RELEASE_ENVELOPE_REQUIRED');
  assert.deepEqual(d.reasons.map(r=>r.field),['approvalReference','expectedManifestChecksum','releaseIdempotencyKey','idempotencyKey']);
  assert.ok(d.reasons.every(r=>r.action));assert.equal(d.retry_allowed,false);assert.deepEqual(calls,[]);
 });
});
for(const kind of ['missing principal','wrong project','forged actor','unsupported operation'])test('generic routing rejects '+kind+' before sender',async t=>{
 const calls=routeMocks(t);let args={...envelope},actor=principal;
 if(kind==='missing principal')actor=null;
 if(kind==='wrong project')actor={...principal,projectId:20};
 if(kind==='forged actor')args.actorId='user:300';
 if(kind==='unsupported operation')args.operation='release';
 await clientFor(registerTaskPublicationTools,async client=>{
  const result=await withPublicationPrincipal(actor,()=>client.callTool({name:kind==='forged actor'?'ba_publish_threads_task':'ba_publish_publication_task',arguments:args}));
  assert.equal(result.isError,true);assert.deepEqual(calls,[]);
  assert.equal(payload(result).code,{'missing principal':'THREADS_PRINCIPAL_REQUIRED','wrong project':'THREADS_PROJECT_SCOPE_MISMATCH','forged actor':'THREADS_ACTOR_SCOPE_MISMATCH','unsupported operation':'THREADS_OPERATION_UNSUPPORTED'}[kind]);
  assert.ok(!JSON.stringify(result).includes('private-provider-secret'));
 });
});
function browserFixture(){
 const task={id:87002,project_id:19,status:'publishing',content_revision:1,accepted_revision:1,draft_text:'private accepted copy',selected_asset:null,selected_asset_id:null,quality_report:{handoff_bundle:{}},publication_fact:null};
 const attempts=[{id:81,status:'pending',requires_manual_confirmation:true,error_message:null,idempotency_key:'private-stable-key',created_at:new Date()}];
 const work=[{id:71,state:'claimed',input_context_version:1,lease_expires_at:new Date(Date.now()+60000),lease_actor_id:principal.actorId}];
 const events=[{command:'ba_start_browser_submission',work_item_id:71,actor_id:principal.actorId,idempotency_key:'private-stable-key',after_state:{attempt_id:81,submission_permitted:false}}];
 const state={task,attempts,work,events,recovery:null};
 const tx={projectMember:{findUnique:async()=>({role:'owner'})},contentItem:{findFirst:async()=>task},deliveryAttempt:{findMany:async()=>attempts},workItem:{findMany:async()=>work,count:async()=>work[0]?.lease_actor_id===principal.actorId&&work[0].state==='claimed'&&work[0].lease_expires_at>new Date()?1:0},workflowEvent:{findMany:async()=>events},browserDeliveryRecovery:{findFirst:async()=>state.recovery},$queryRaw:async()=>[{available:true}]};
 return{state,tx,run:async(fn)=>fn(tx)};
}
async function browserResult(t,f){
 const original=db.$transaction;db.$transaction=f.run;t.after(()=>{db.$transaction=original;});
 return clientFor(registerBrowserPublicationTools,client=>withPublicationPrincipal(principal,()=>client.callTool({name:'ba_diagnose_browser_publication',arguments:{projectId:19,taskId:87002,actorId:principal.actorId}})));
}
test('registered browser diagnosis distinguishes active preparation without claiming dispatch absence or permission',async t=>{
 const f=browserFixture(),before=structuredClone(f.state),r=await browserResult(t,f),d=payload(r);
 assert.equal(d.next_action,'continue_existing_preparation');assert.equal(d.execution_state.code,'BROWSER_PREPARATION_ACTIVE');
 assert.equal(d.execution_state.delivery_certainty,'UNKNOWN');assert.equal(d.recovery,null);assert.equal(d.submission_permitted,false);assert.equal(d.retry_allowed,false);
 assert.deepEqual(f.state,before);for(const secret of ['private accepted copy','private-stable-key'])assert.ok(!JSON.stringify(r).includes(secret));
});
for(const kind of ['expired lease','wrong actor'])test('registered diagnosis explains '+kind+' and preserves same attempt',async t=>{
 const f=browserFixture();if(kind==='expired lease')f.state.work[0].lease_expires_at=new Date(Date.now()-1000);else f.state.work[0].lease_actor_id='user:300';
 const before=structuredClone(f.state),r=await browserResult(t,f),d=payload(r);
 assert.equal(d.next_action,'recover_existing_preparation');assert.equal(d.execution_state.code,kind==='expired lease'?'BROWSER_PREPARATION_LEASE_EXPIRED':'BROWSER_PREPARATION_EXECUTOR_UNAVAILABLE');
 assert.match(d.execution_state.action,/same attempt/i);assert.equal(d.submission_permitted,false);assert.deepEqual(f.state,before);
});
for(const kind of ['permit','dispatch','error','missing history','multiple attempts','malformed start','persisted recovery','history cap'])test('diagnosis keeps '+kind+' reconciliation-only',async t=>{
 const f=browserFixture();
 if(kind==='permit')f.state.events.push({command:'ba_pre_submit_browser_submission',work_item_id:71,after_state:{attempt_id:81,submission_permitted:true}});
 if(kind==='dispatch')f.state.events.push({command:'browser_preparation_dispatch_started',work_item_id:71,after_state:{attempt_id:81}});
 if(kind==='error')f.state.attempts[0].error_message='private-provider-secret';
 if(kind==='missing history')f.state.events.length=0;
 if(kind==='multiple attempts')f.state.attempts.push({...f.state.attempts[0],id:82});
 if(kind==='malformed start')f.state.events[0].after_state={attempt_id:999};
 if(kind==='persisted recovery')f.state.recovery={state:'held',cause_code:'POST_SUBMIT_UNKNOWN'};
 if(kind==='history cap')for(let i=0;i<201;i++)f.state.events.push({command:'synthetic_other',after_state:{}});
 const before=structuredClone(f.state),r=await browserResult(t,f),d=payload(r);
 assert.equal(d.next_action,'reconcile_existing_attempt');assert.notEqual(d.execution_state?.code,'BROWSER_PREPARATION_ACTIVE');assert.equal(d.submission_permitted,false);assert.ok(d.recovery);assert.deepEqual(f.state,before);assert.ok(!JSON.stringify(r).includes('private-provider-secret'));
});
test.after(async()=>{await db.$disconnect();await pool.end();});
for(const kind of ['owned route','telegram route','Threads envelope on another provider'])test('shared dispatch preserves '+kind,async t=>{
 t.mock.method(legacy,'isThreadsTask',async()=>false);
 let ownedCalls=0,telegramCalls=0;
 t.mock.method(owned,'tryOwnedPublicationTask',async()=>{ownedCalls++;return kind==='owned route'?{state:'preview',provider:'dzen'}:null;});
 const telegram=require(path.join(base,'services/telegram_task_publication.service.js')).default;
 t.mock.method(telegram,'execute',async()=>{telegramCalls++;return{mode:'dry_run'};});
 await clientFor(registerTaskPublicationTools,async client=>{
  const args={projectId:19,taskId:87003,dryRun:true,...(kind==='Threads envelope on another provider'?{releaseIdempotencyKey:'synthetic-release'}:{})};
  const r=await withPublicationPrincipal(principal,()=>client.callTool({name:'ba_publish_publication_task',arguments:args}));
  if(kind==='Threads envelope on another provider'){assert.equal(r.isError,true);assert.equal(ownedCalls,1);assert.equal(telegramCalls,0);}
  else{assert.notEqual(r.isError,true);assert.equal(ownedCalls,1);assert.equal(telegramCalls,kind==='owned route'?0:1);}
 });
});
test('registered browser diagnosis of confirmed fact is read-only and cannot suggest preparation',async t=>{
 const f=browserFixture();f.state.task.publication_fact={id:4,public_url:'https://example.invalid/existing',provider_object_id:'synthetic-existing',published_at:new Date()};
 const before=structuredClone(f.state),r=await browserResult(t,f),d=payload(r);
 assert.equal(d.next_action,'read_only');assert.equal(d.execution_state,null);assert.equal(d.submission_permitted,false);assert.deepEqual(f.state,before);
});
test('registered browser diagnosis rejects revoked Owner without exposing data',async t=>{
 const f=browserFixture();f.tx.projectMember.findUnique=async()=>({role:'editor'});const before=structuredClone(f.state),r=await browserResult(t,f);
 assert.equal(r.isError,true);assert.equal(payload(r).code,'OWNER_REQUIRED');assert.ok(!JSON.stringify(r).includes('private'));assert.deepEqual(f.state,before);
});

for(const command of ['ba_publish_publication_task','ba_publish_threads_task'])test(command+' returns the same manifest diagnosis without raw provider data',async t=>{
 const calls=routeMocks(t,'MCP_PROJECT_SCOPE_MISMATCH');
 await clientFor(registerTaskPublicationTools,async client=>{
  const r=await withPublicationPrincipal(principal,()=>client.callTool({name:command,arguments:envelope}));
  assert.equal(r.isError,true);assert.equal(payload(r).code,'MCP_PROJECT_SCOPE_MISMATCH');
  assert.equal(payload(r).reasons[0].field,'manifest');assert.equal(calls.length,1);assert.ok(!JSON.stringify(r).includes('private-provider-secret'));
 });
});
