const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {fixture,base}=require('./threads-api.fixture.cjs');
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.ts'));
test('T01/T04 arbitrary tenant generic release sends once and canonical recovery replays',async()=>{
 const f=fixture();await f.service.release(f.release);const result=await f.service.publish(f.send);
 assert.equal(result.mode,'published');assert.equal(f.calls,2);assert.equal(f.rows[0].state,'confirmed');assert.equal(f.attempts[0].status,'delivered');
 const replay=await f.service.reconcile(f.reconcile);assert.equal(replay.provider_object_id,'123');assert.equal(f.calls,2);
});
test('T03/T08 lost readback consumes bounded retries but never reissues POST',async()=>{
 const f=fixture();await f.service.release(f.release);f.failRead=true;
 await assert.rejects(f.service.publish(f.send),/LOOKUP_INCOMPLETE/);assert.equal(f.calls,2);assert.equal(f.rows[0].post_id,'123');
 assert.equal(f.rows[0].rounds,3);assert.equal(f.rows[0].requests_used,6);
 await assert.rejects(f.service.reconcile(f.reconcile),/BUDGET_EXHAUSTED/);assert.equal(f.calls,2);
});
test('T04 post-send fact outage preserves provider ID and later same-attempt recovery',async()=>{
 const f=fixture();await f.service.release(f.release);f.failFact=true;
 await assert.rejects(f.service.publish(f.send),/FACT_COMMIT_PENDING/);assert.equal(f.rows[0].post_id,'123');assert.equal(f.calls,2);
 f.failFact=false;await assert.rejects(f.service.reconcile(f.reconcile),/IN_PROGRESS/);
 f.advance(40_000);assert.equal((await f.service.reconcile(f.reconcile)).mode,'published');assert.equal(f.calls,2);
});
test('T07 denied owner makes zero provider calls',async()=>{
 const f=fixture();await f.service.release(f.release);f.owner=false;
 await assert.rejects(f.service.publish(f.send),/OWNER_REQUIRED/);assert.equal(f.calls,0);
});
test('T03 lost publish response freezes saved container without a second publication',async()=>{
 const f=fixture();await f.service.release(f.release);
 f.deps.threads.publishVerifiedText=async(user,token,body,name,journal)=>{
 await journal.beforeCreate();await journal.containerCreated('456');await journal.beforePublish();throw Error('synthetic-secret');};
 await assert.rejects(f.service.publish(f.send),/IDENTITY_UNAVAILABLE/);assert.equal(f.rows[0].state,'publish_started');assert.equal(f.rows[0].container_id,'456');
 await assert.rejects(f.service.publish(f.send),/PACKAGE_GUARD_FAILED/);assert.equal(f.reads,0);
});
test('T06 foreign profile prevents object read and exposes precise safe reason',async()=>{
 const f=fixture();await f.service.release(f.release);let objects=0;
 f.deps.threads.readRecoveryProfile=async()=>({id:'999',username:'tester'});f.deps.threads.readRecoveryPost=async()=>{objects++;throw Error('unexpected');};
 await assert.rejects(f.service.publish(f.send),/ACCOUNT_MISMATCH/);assert.equal(objects,0);assert.equal(f.rows[0].rounds,1);
});
test('T08 caller cancellation stops readback and preserves durable consumed reservation',async()=>{
 const f=fixture();await f.service.release(f.release);f.failFact=true;await assert.rejects(f.service.publish(f.send),/FACT_COMMIT_PENDING/);
 f.rows[0].lease_expires_at=new Date(0);f.rows[0].next_read_at=new Date(0);f.failFact=false;
 const abort=new AbortController();let objects=0;
 f.deps.threads.readRecoveryProfile=async()=>{abort.abort();return{id:'789',username:'tester'};};
 f.deps.threads.readRecoveryPost=async()=>{objects++;throw Error('unexpected');};
 await assert.rejects(f.service.reconcile(f.reconcile,abort.signal),/INTERRUPTED/);assert.equal(objects,0);assert.equal(f.rows[0].rounds,2);
 assert.equal(f.task.publication_fact,null);assert.equal(f.rows[0].lease_sha256,null);
});
test('T07 lease expiry during provider response cannot finalize',async()=>{
 const f=fixture();await f.service.release(f.release);const saved=f.deps.threads.readRecoveryPost;
 f.deps.threads.readRecoveryPost=async(...args)=>{const post=await saved(...args);f.advance(40_000);return post;};
 await assert.rejects(f.service.publish(f.send),/RECOVERY_CONFLICT/);assert.equal(f.rows[0].state,'provider_id_recorded');assert.equal(f.task.publication_fact,null);
});
test('T10 actual MCP serialization preserves recovery explanation and no secret',async()=>{
 const f=fixture();const service=require(path.join(base,'services/threads_generic_release.service.ts')).default;
 const saved=service.deps;service.deps=f.deps;
 const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
 const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');const {registerTaskPublicationTools}=require(path.join(base,'mcp/tools/task_publication_tools.ts'));
 const server=new McpServer({name:'threads-test',version:'1'}),client=new Client({name:'operator',version:'1'});registerTaskPublicationTools(server);
 const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);
 const listing=await client.listTools();const tool=listing.tools.find(t=>t.name==='ba_reconcile_threads_publication');
 assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.openWorldHint,true);assert.equal(tool.annotations.destructiveHint,false);
 await f.service.release(f.release);await f.service.publish(f.send);f.rows[0].state='provider_id_recorded';f.rows[0].post_id=null;f.task.publication_fact=null;f.task.status='publishing';f.attempts[0].status='pending';
 const result=await client.callTool({name:'ba_reconcile_threads_publication',arguments:f.reconcile});
 const payload=result.structuredContent||JSON.parse(result.content[0].text);assert.equal(payload.code,'THREADS_RECOVERY_IDENTITY_UNAVAILABLE');
 assert.ok(payload.reasons[0].action);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));assert.equal(f.calls,2);
 }finally{await client.close();await server.close();service.deps=saved;}
});
test('T10 remote identity and capability cannot be overridden for API recovery',()=>{
 const{scopeRemoteMcpRequest}=require(path.join(base,'mcp/remote-auth.ts'));
 const body={method:'tools/call',params:{name:'ba_reconcile_threads_publication',arguments:{projectId:61,taskId:62,attemptId:65,actorId:'user:999'}}};
 const principal={userId:64,actorId:'user:64',projectId:61,profile:'publisher'};
 const scoped=scopeRemoteMcpRequest(body,principal);assert.equal(scoped.allowed,true);assert.equal(scoped.body.params.arguments.actorId,'user:64');
 assert.equal(scopeRemoteMcpRequest(body,{...principal,profile:'writer'}).allowed,false);
 assert.equal(scopeRemoteMcpRequest(body,{...principal,projectId:99}).allowed,false);
});
for(const change of ['schedule','decision'])test('T07 changed released '+change+' blocks the publication POST',async()=>{
 const f=fixture();await f.service.release(f.release);let posts=0;
 f.deps.threads.publishVerifiedText=async(user,token,body,name,journal)=>{
 await journal.beforeCreate();posts++;await journal.containerCreated('456');
 if(change==='schedule')f.task.schedule_at=new Date('2026-10-20T10:00:00Z');
 else f.deps.db.artDirectionDecision.findFirst=async()=>({id:999,decision:'NO_VISUAL_NEEDED',channel:'threads',source_content_revision:1,decision_version:1});
 await journal.beforePublish();posts++;throw Error('unexpected publication');};
 await assert.rejects(f.service.publish(f.send),/PACKAGE_CHANGED/);assert.equal(posts,1);assert.equal(f.rows[0].state,'container_ready');
});
for(const change of ['schedule','decision'])test('T07 changed released '+change+' blocks recovery before GET',async()=>{
 const f=fixture();await f.service.release(f.release);f.failFact=true;await assert.rejects(f.service.publish(f.send),/FACT_COMMIT_PENDING/);
 const reads=f.reads;if(change==='schedule')f.task.publish_at=new Date('2026-10-20T10:00:00Z');
 else f.deps.db.artDirectionDecision.findFirst=async()=>({id:999,decision:'NO_VISUAL_NEEDED',channel:'threads',source_content_revision:1,decision_version:1});
 await assert.rejects(f.service.reconcile(f.reconcile),/PACKAGE_CHANGED/);assert.equal(f.reads,reads);assert.equal(f.calls,2);
});
test('T10 total DB outage after publication returns actionable persistence error through actual MCP',async()=>{
 const f=fixture(),service=require(path.join(base,'services/threads_generic_release.service.ts')).default,saved=service.deps;service.deps=f.deps;
 await f.service.release(f.release);const transaction=f.deps.db.$transaction;
 f.deps.db.$transaction=async(...args)=>{if(f.calls>=2)throw Error('synthetic-secret-DB');return transaction(...args);};
 const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js');
 const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js'),{registerTaskPublicationTools}=require(path.join(base,'mcp/tools/task_publication_tools.ts'));
 const server=new McpServer({name:'threads-db-fault',version:'1'}),client=new Client({name:'operator',version:'1'});registerTaskPublicationTools(server);
 const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);
 const response=await withPublicationPrincipal({userId:Number(f.send.actorId.slice(5)),actorId:f.send.actorId,projectId:f.send.projectId,profile:'publisher'},()=>client.callTool({name:'ba_publish_threads_task',arguments:f.send}));const result=response.structuredContent;
 assert.equal(result.code,'THREADS_ATTEMPT_PERSISTENCE_UNAVAILABLE');assert.ok(!JSON.stringify(response).includes('synthetic-secret-DB'));
 assert.equal(f.rows[0].post_id,undefined);assert.equal(f.rows[0].state,'publish_started');assert.equal(f.calls,2);
 }finally{await client.close();await server.close();service.deps=saved;}
});
test('T07 package change after dispatch retains original post ID but blocks confirmation',async()=>{
 const f=fixture();await f.service.release(f.release);
 f.deps.threads.publishVerifiedText=async(user,token,body,name,journal)=>{
 await journal.beforeCreate();await journal.containerCreated('456');await journal.beforePublish();
 f.task.publish_at=new Date('2026-10-20T10:00:00Z');await journal.published('123');throw Error('readback unavailable');};
 await assert.rejects(f.service.publish(f.send),/PACKAGE_CHANGED/);assert.equal(f.rows[0].post_id,'123');assert.equal(f.task.publication_fact,null);
});
