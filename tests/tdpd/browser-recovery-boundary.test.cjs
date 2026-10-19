const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {fixture,request}=require('./shared-browser.fixture.cjs');
const release=require(path.join(base,'services/browser_publication_release.js'));
const execution=require(path.join(base,'services/browser_publication_execution.js'));
const {diagnoseBrowserPublication}=require(path.join(base,'services/browser_publication_diagnostics.js'));
async function started(){
 const deps=fixture();await release.repairBrowserPublicationMetadata({...request,apply:true,idempotencyKey:'repair'},deps);
 const r=await release.releaseBrowserPublication({...request,apply:true},deps);
 const claim=await execution.claimBrowserPublication({...request,workItemId:r.browser_work_item_id,idempotencyKey:'claim'},deps);
 const args={...request,workItemId:r.browser_work_item_id,leaseToken:claim.lease_token,idempotencyKey:'send'};
 const begin=await execution.startBrowserSubmission(args,deps);return{deps,args,attemptId:begin.attempt_id};
}
test('operator sees capability gap and no fabricated automatic provider lookup after uncertainty',async()=>{
 const{deps,args,attemptId}=await started();
 const result=await execution.markBrowserSubmissionUncertain({...args,attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps);
 assert.equal(result.recovery.code,'READBACK_CAPABILITY_UNAVAILABLE');
 assert.equal(result.recovery.deliveryCertainty,'UNKNOWN');
 assert.equal(result.recovery.recoveryAction,'CONTACT_ENGINEERING');
 assert.equal(result.submission_permitted,false);assert.equal(result.retry_allowed,false);
 assert.equal(deps.state.attempts.length,1);assert.equal(deps.state.fact,null);
});
test('legacy prepare failure cannot be mislabeled definitely not sent without controlled executor proof',async()=>{
 const{deps,args,attemptId}=await started();
 await execution.markBrowserSubmissionUncertain({...args,attemptId,reasonCode:'PRE_SUBMIT_REJECTED'},deps);
 const result=await diagnoseBrowserPublication({projectId:request.projectId,taskId:request.taskId,actorId:request.actorId},deps);
 assert.equal(result.recovery.code,'PRE_DISPATCH_PROOF_UNAVAILABLE');
 assert.equal(result.recovery.deliveryCertainty,'UNKNOWN');assert.equal(result.recovery.retry_allowed,false);
 assert.equal(result.recovery.submission_permitted,false);
 assert.ok(result.recovery.message);assert.ok(result.recovery.action);
});
test('scoped diagnostic permission denial returns no recovery evidence',async()=>{
 const{deps}=await started();deps.state.owner=false;
 await assert.rejects(diagnoseBrowserPublication({projectId:request.projectId,taskId:request.taskId,actorId:request.actorId},deps),/OWNER/);
});
test('real MCP serialization preserves actionable recovery code and correction without lease or raw error',async()=>{
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
 const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
 const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 const {registerBrowserPublicationTools}=require(path.join(base,'mcp/tools/browser_publication_tools.js'));
 const {browserDefaults}=require(path.join(base,'services/browser_publication_contract.js'));
 const {deps,args,attemptId}=await started(),saved={...browserDefaults};Object.assign(browserDefaults,deps);
 const server=new McpServer({name:'recovery-acceptance',version:'1'}),client=new Client({name:'operator',version:'1'});
 registerBrowserPublicationTools(server);const[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);
  const result=await client.callTool({name:'ba_mark_browser_submission_uncertain',arguments:{...args,attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'}});
  const payload=result.structuredContent||JSON.parse(result.content[0].text);
  assert.equal(payload.recovery.code,'READBACK_CAPABILITY_UNAVAILABLE');assert.equal(payload.recovery.recoveryAction,'CONTACT_ENGINEERING');
  assert.equal(payload.recovery.deliveryCertainty,'UNKNOWN');assert.ok(payload.recovery.action);assert.ok(!JSON.stringify(result).includes(args.leaseToken));
 }finally{await client.close();await server.close();Object.assign(browserDefaults,saved);}
});
test('resume denial exposes structured reason, stage, certainty and concrete action',async()=>{
 const {resumeBrowserRecovery}=require(path.join(base,'services/browser_recovery_resume.js'));
 const result=await resumeBrowserRecovery({projectId:1,taskId:2,attemptId:3,actorId:'user:4',idempotencyKey:'missing'}, {transaction:run=>run({load:async()=>null})});
 assert.equal(result.code,'RECOVERY_SCOPE_MISMATCH');assert.equal(result.deliveryCertainty,'UNKNOWN');
 assert.equal(result.recoveryAction,'CONTACT_ENGINEERING');assert.equal(result.stage,'PREPARE');assert.ok(result.message);assert.ok(result.action);
});
