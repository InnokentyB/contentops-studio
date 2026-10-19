const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({transpileOnly:true});
const root = path.resolve(__dirname, '../..');
function feature(name) {
  const target = path.join(root,'src/services',name+'.ts');
  assert.ok(fs.existsSync(target), `DZEN1002-RUNTIME-RED: ${name} behavior absent`);
  return require(target);
}
const args = {projectId:10,taskId:1002,actorId:'user:2',expectedManifestChecksum:'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7', idempotencyKey:'runtime-fixture',dryRun:false};
function harness() {
  const calls=[]; const claim={attemptId:41,key:args.idempotencyKey,package:{digest:'d'.repeat(64),body:'private fixture',title:'fixture',assetUrl:'https://assets.example.test/a.png'}};
  const receipt={attemptId:41}; let prior=null;
  const ports={
    authorize:op=>calls.push(`authorize:${op}`),
    replay:async()=>{calls.push('replay');return prior;},
    inspect:async()=>{calls.push('inspect');return claim.package;},
    claim:async()=>{calls.push('claim');return claim;},
    start:async()=>{calls.push('start');},assertSubmit:async()=>{calls.push('submit-fence');},
    publish:async(c,hooks)=>{assert.equal(c,claim);await hooks.beforeMutation();await hooks.beforeSubmit();calls.push('native');return receipt;},
    saveReceipt:async(a,c,r)=>{assert.equal(r,receipt);calls.push('receipt');},
    confirm:async()=>{calls.push('confirm');return {mode:'published',task_id:1002,attempt_id:41,retry_allowed:false,published_link:'https://dzen.ru/a/fixture',external_id:'fixture'};},
    loadClaim:async()=>{calls.push('load');return claim;},
    uncertain:async()=>{calls.push('uncertain');}
  };
  return {calls,ports,prior:v=>prior=v};
}
test('R01 command lifecycle commits start before native and receipt before fact',async()=>{
 const f=feature('dzen1002_runtime'); const h=harness();
 const result=await f.executeDzen1002(args,h.ports);
 assert.equal(result.mode,'published');
 assert.deepEqual(h.calls,['replay','authorize:publish','claim','start','submit-fence','native','receipt','confirm']);
});
test('R03 unresolved action scope is local precise cause, before replayed success/session access',async()=>{
 const {requireDzen1002Action,DZEN1002_RESTRICTION}=feature('dzen1002_action_restriction');
 assert.equal(DZEN1002_RESTRICTION.source,'browser_use_tool_result');
 assert.equal(DZEN1002_RESTRICTION.blockedOutcomeUrl,'https://dzen.ru/a/asvdioZFzXeQEO5O');
 for(const op of ['inventory','publish','readback']) assert.throws(()=>requireDzen1002Action(op),/DZEN1002_ACTION_SCOPE_UNRESOLVED/);
 const f=feature('dzen1002_runtime');const h=harness();h.prior({mode:'published'});
 h.ports.authorize=requireDzen1002Action;
 await assert.rejects(f.executeDzen1002(args,h.ports),/DZEN1002_ACTION_SCOPE_UNRESOLVED/);
 assert.deepEqual(h.calls,['replay']);
});
test('R02 invalid and caller-extended commands cannot reach any port',async()=>{
 const f=feature('dzen1002_runtime');
 for(const change of [{projectId:7},{taskId:1045},{actorId:'system:owner'},{expectedManifestChecksum:'sha256:'+'f'.repeat(64)},{provider_admission:'permitted'},{idempotencyKey:''}]){
  const h=harness(); await assert.rejects(f.executeDzen1002({...args,...change},h.ports));assert.deepEqual(h.calls,[]);
 }
});
test('R06 failure after native freezes original attempt; next key sees same history, no resend',async()=>{
 const f=feature('dzen1002_runtime');const h=harness();h.ports.saveReceipt=async()=>{h.calls.push('receipt-failed');throw new Error('cookie=SECRET');};
 const result=await f.executeDzen1002(args,h.ports);
 assert.equal(result.mode,'verification_required');assert.equal(result.retry_allowed,false);
 assert.ok(!JSON.stringify(result).includes('SECRET'));
 assert.deepEqual(h.calls,['replay','authorize:publish','claim','start','submit-fence','native','receipt-failed','uncertain']);
 h.calls.length=0;h.prior(result);await f.executeDzen1002({...args,idempotencyKey:'another'},h.ports);
 assert.deepEqual(h.calls,['replay','authorize:publish']);
});
test('R07 reconciliation performs DB-only completion, with no native dispatch or policy probe',async()=>{
 const f=feature('dzen1002_runtime');const h=harness();
 const {dryRun,...reconcileArgs}=args;
 const result=await f.reconcileDzen1002({...reconcileArgs,attemptId:41},h.ports);
 assert.equal(result.mode,'published');assert.deepEqual(h.calls,['load','confirm']);
});
test('R08 transport cannot return a receipt without both committing hooks',async()=>{
 const f=feature('dzen1002_runtime');const h=harness();h.ports.publish=async()=>({attemptId:41});
 const result=await f.executeDzen1002(args,h.ports);assert.equal(result.mode,'verification_required');
 assert.ok(!h.calls.includes('receipt'));assert.ok(!h.calls.includes('confirm'));
});
test('R09 dry-run is metadata-only and cannot export accepted body or asset URL',async()=>{
 const f=feature('dzen1002_runtime');const h=harness();
 const result=await f.executeDzen1002({...args,dryRun:true},h.ports);
 assert.equal(result.mode,'dry_run');assert.deepEqual(h.calls,['replay','inspect']);
 assert.ok(!JSON.stringify(result).includes('private fixture'));assert.ok(!JSON.stringify(result).includes('assets.example'));
});
test('R10 generic canonical fact guard refuses1002 after scoped history reads without writes',async()=>{
 const {guardManualPublicationFact}=require(path.join(root,'src/services/publication_manual_fact_guard.ts'));
 const reads=[];const scope={project_id:10,content_item_id:1002};
 const db=new Proxy({workflowEvent:{findFirst:async args=>{assert.deepEqual(args.where,{...scope,command:{startsWith:'owned_publication.'}});reads.push('history');return null;}},connectorDispatchJob:{findFirst:async args=>{assert.deepEqual(args.where,{...scope,binding:{path:['protocol'],equals:'owned_provider_v1'}});reads.push('job');return null;}},contentItem:{findFirst:async args=>{assert.deepEqual(args.where,{project_id:10,id:1002});reads.push('task');return null;}}}, {get(target,key){if(key in target)return target[key];throw Error('FORBIDDEN_DB');}});
 await assert.rejects(guardManualPublicationFact(db,{projectId:10,taskId:1002,internalConfirmation:false}),/DZEN1002_EXACT_CONFIRMATION_REQUIRED/);
 assert.deepEqual(reads,['history','job','task']);
});
test('R01/R10 registered bounded Publisher commands exercise the new lifecycle',async()=>{
 const {z}=require('zod');
 const {registerTomorrowPublicationTools}=require(path.join(root,'src/mcp/tools/tomorrow_publication_tools.ts'));
 const {isToolAllowedForProfile}=require(path.join(root,'src/mcp/capabilities.ts'));
 const handlers=new Map();const schemas=new Map();let called=0;
 const server={registerTool(name,config,handler){handlers.set(name,handler);schemas.set(name,z.object(config.inputSchema).strict());}};
 registerTomorrowPublicationTools(server,{publish:async a=>{called++;return feature('dzen1002_runtime').executeDzen1002(a,harness().ports);},reconcile:async a=>{called++;return feature('dzen1002_runtime').reconcileDzen1002(a,harness().ports);}});
 const name='ba_reconcile_dzen_task1002';assert.ok(handlers.has(name),'DZEN1002-RUNTIME-RED: bounded reconciliation command absent');
 assert.equal(isToolAllowedForProfile('publisher',name),true);assert.equal(isToolAllowedForProfile('writer',name),false);assert.equal(isToolAllowedForProfile('planner',name),false);
 const {dryRun,...a}=args;const input={...a,attemptId:41};
 assert.equal(schemas.get(name).safeParse({...input,publicUrl:'https://evil.example'}).success,false);
 await handlers.get('ba_publish_dzen_task1002')(args);await handlers.get(name)(input);assert.equal(called,2);
});
