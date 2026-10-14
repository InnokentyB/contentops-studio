const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const MODULE = '../../dist/services/vk1048_operator_preflight.js';
const binding = { projectId:10, taskId:1048, channelId:117, communityId:-240051152, revision:1, selectedAssetId:130, placement:'feed', bodySha256:'5cc11b6f7a5d8a2abf7a10ca2d005bf6cdd1c010a97ebedcd49e1092d5b874ab', assetSha256:'1e7ef29ec003f18c242af5ca4d15d9f4990539ed905398a14df0d3071b4aa81e', releaseSha256:'795b2310bb2d50d3b8575646a77ad9323099e7c365061b2bb492acebb1b1dba5' };
const hash = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
const job = {jobId:'3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de',state:'blocked',generation:3,packageSha256:hash,blocker:'PROVIDER_PERMISSION_UNVERIFIED',attemptId:null,factId:null,publicUrl:null};
const config = {projectId:10, hostId:'vk-connector-local-1048', endpoint:'https://planner-mcp-production.up.railway.app/mcp/publisher',mode:'vk_feed_provider',buildVersion:'fixture',runtimeDir:'/unused',tokenEnvVar:'CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN'};
function harness(change={}) {
 let calls=[], inspected=0, closed=0;
 const control={close:async()=>{},call:async(name,args)=>{calls.push(name); assert.equal(args.projectId,10); assert.equal(args.actorId,'user:0');
  if(name==='ba_preview_vk_connector_dispatch')return {package:binding,packageSha256:hash};
  if(name==='ba_get_vk_connector_job')return {...job,...change};
  if(name==='ba_get_vk_connector_health')return {hostId:config.hostId,mode:'vk_feed_provider',providerExecution:'blocked',status:'online',heartbeatAt:new Date().toISOString()};
  throw Error('Forbidden mutation');}};
 const resources=()=>({profile:'PASS',evidence:'PASS',dependency:'PASS'});
 const fixture={kind:'offline_fixture', inspect:async()=>{inspected++;return {loggedIn:true,communityAdmin:true,communityId:-240051152,coverage:'complete_window',objects:3,mediaSha256:binding.assetSha256,rawCookie:'never-output',text:'never-output'};},close:async()=>{closed++;}};
 return {control,resources,fixture,calls,inspectCount:()=>inspected,closeCount:()=>closed};
}
test('PF143-01 default production admission blocks before session, uses READ commands only and preserves exact job',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE),h=harness();const result=await runVk1048OperatorPreflight(config,h.control,{resources:h.resources});
 assert.equal(result.scope.taskId,1048);assert.equal(result.scope.channelId,117);assert.equal(result.scope.jobId,job.jobId);assert.equal(result.status,'BLOCKED');assert.equal(result.admission,'ACTION_TIME_ADMISSION_UNAVAILABLE');assert.equal(result.generation,3);assert.equal(result.packageSha256,hash);
 assert.deepEqual(new Set(h.calls),new Set(['ba_preview_vk_connector_dispatch','ba_get_vk_connector_job','ba_get_vk_connector_health']));assert.equal(h.inspectCount(),0);
});
test('PF143-02 missing local resources are diagnosed separately from admission',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE),h=harness();const result=await runVk1048OperatorPreflight(config,h.control);
 assert.equal(result.resources.profile,'UNCONFIGURED');assert.equal(result.resources.evidence,'UNCONFIGURED');assert.equal(result.admission,'ACTION_TIME_ADMISSION_UNAVAILABLE');
});
test('PF143-03 offline positive reports fixture provenance, no real authority, sanitizes body/secrets and closes once',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE),h=harness();const result=await runVk1048OperatorPreflight(config,h.control,{resources:h.resources,fixture:h.fixture});
 assert.equal(result.status,'OFFLINE_FIXTURE_CHECKED');assert.equal(result.productionReady,false);assert.equal(result.objects,3);assert.equal(h.closeCount(),1);
 assert.equal(JSON.stringify(result).includes('never-output'),false);assert.equal(result.generation,3);
});
test('PF143-04 login/admin/partial/media/overflow mismatch remain UNKNOWN and close fixture',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE);
 for(const change of [{loggedIn:false},{communityAdmin:false},{communityId:-9},{coverage:'partial'},{objects:101},{mediaSha256:'d'.repeat(64)}]){
  const h=harness();h.fixture.inspect=async()=>({loggedIn:true,communityAdmin:true,communityId:-240051152,coverage:'complete_window',objects:3,mediaSha256:binding.assetSha256,...change});
  const r=await runVk1048OperatorPreflight(config,h.control,{resources:h.resources,fixture:h.fixture});assert.equal(r.status,'UNKNOWN');assert.equal(r.productionReady,false);assert.equal(h.closeCount(),1);
 }
});
test('PF143-05 started/uncertain jobs allow diagnostic only, never invoke fixture',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE);
 for(const change of [{state:'verification_required'},{state:'executing',attemptId:9}]){
  const h=harness(change);const r=await runVk1048OperatorPreflight(config,h.control,{resources:h.resources,fixture:h.fixture});assert.equal(r.reason,'RECONCILIATION_REQUIRED');assert.equal(h.inspectCount(),0);
 }
});
test('PF143-06 timeout, cleanup failure and untrusted control errors are sanitized',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE),h=harness();h.fixture.inspect=async()=>new Promise(()=>{});
 const r=await runVk1048OperatorPreflight(config,h.control,{resources:h.resources,fixture:h.fixture,timeoutMs:10});assert.equal(r.status,'UNKNOWN');assert.equal(h.closeCount(),1);
 const bad=harness();bad.fixture.close=async()=>{throw Error('raw credential');};const q=await runVk1048OperatorPreflight(config,bad.control,{resources:bad.resources,fixture:bad.fixture});assert.equal(q.reason,'SESSION_CLEANUP_UNCONFIRMED');assert.equal(JSON.stringify(q).includes('raw credential'),false);
});
test('PF143-07 control allowlist rejects mutations before outbound transport',async()=>{
 const {createVk1048PreflightReader}=require(MODULE),h=harness();const read=createVk1048PreflightReader(h.control);
 assert.throws(()=>read.call('ba_resume_vk_connector_job',{}),/PREFLIGHT_READ_ONLY/);assert.equal(h.calls.length,0);
});
test('PF143-08 state drift, foreign scope, malformed fixture and stale heartbeat fail closed',async()=>{
 const {runVk1048OperatorPreflight}=require(MODULE);
 const h=harness();let reads=0;const original=h.control.call;h.control.call=async(n,a,s)=>{const r=await original(n,a,s);return n==='ba_get_vk_connector_job'&&++reads>1?{...r,generation:4}:r;};
 assert.equal((await runVk1048OperatorPreflight(config,h.control,{resources:h.resources})).reason,'SNAPSHOT_CHANGED');
 assert.equal((await runVk1048OperatorPreflight({...config,projectId:99},harness().control)).status,'BLOCKED');
 const bad=harness();bad.fixture.inspect=async()=>({loggedIn:true});assert.equal((await runVk1048OperatorPreflight(config,bad.control,{resources:bad.resources,fixture:bad.fixture})).status,'UNKNOWN');
 const stale=harness();const originalStale=stale.control.call;stale.control.call=async(n,a,s)=>n==='ba_get_vk_connector_health'?{hostId:config.hostId,status:'online',heartbeatAt:'2020-01-01T00:00:00Z'}:originalStale(n,a,s);assert.equal((await runVk1048OperatorPreflight(config,stale.control,{resources:stale.resources,fixture:stale.fixture})).reason,'HOST_OFFLINE');assert.equal(stale.inspectCount(),0);
});

test('PF143-09 private resource metadata checks reject symlinks/permissions without creating or reading profile contents',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {inspectVk1048PreflightResources}=require('../../dist/services/vk1048_preflight_resources.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vk143-resource-'));try{
  fs.chmodSync(dir,0o700);const link=path.join(dir,'link');fs.symlinkSync(dir,link);
  assert.equal(inspectVk1048PreflightResources({...config,profileDirectory:dir,evidenceDir:dir}).profile,'PASS');
  assert.equal(inspectVk1048PreflightResources({...config,profileDirectory:link,evidenceDir:dir}).profile,'INVALID');
  fs.chmodSync(dir,0o755);assert.equal(inspectVk1048PreflightResources({...config,profileDirectory:dir,evidenceDir:dir}).profile,'INVALID');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('PF143-10 worker readiness closes its read-only transport, changes no files and emits only sanitized JSON',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {runVkConnectorOperatorPreflight}=require('../../dist/workers/vk_connector_consumer.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vk143-entry-'));const file=path.join(dir,'config.json');
 const key='CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN',old=process.env[key];const write=process.stdout.write;
 const h=harness();let closes=0,out='';h.control.close=async()=>{closes++;};
 try{
  fs.writeFileSync(file,JSON.stringify({...config,runtimeDir:dir}),{mode:0o600});process.env[key]='offline-readiness-fixture';
  process.stdout.write=function(value){out+=String(value);return true;};
  await runVkConnectorOperatorPreflight(file,new AbortController().signal,async()=>h.control);
 }finally{
  process.stdout.write=write;if(old===undefined)delete process.env[key];else process.env[key]=old;
 }
 try{
  assert.equal(closes,1);assert.deepEqual(fs.readdirSync(dir),['config.json']);const r=JSON.parse(out);assert.equal(r.productionReady,false);assert.equal(r.status,'BLOCKED');
  assert.equal(out.includes('offline-readiness-fixture'),false);assert.equal(out.includes(dir),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('PF143-11 config flags cannot manufacture admission and forbidden reader scope never reaches transport',async()=>{
 const {runVk1048OperatorPreflight,createVk1048PreflightReader}=require(MODULE);const h=harness();
 assert.equal((await runVk1048OperatorPreflight({...config,permission:'PERMITTED'},h.control)).status,'BLOCKED');assert.equal(h.calls.length,0);
 assert.throws(()=>createVk1048PreflightReader(h.control).call('ba_get_vk_connector_job',{projectId:99,actorId:'user:0',jobId:job.jobId}));assert.equal(h.calls.length,0);
});

test('PF143-12 production transport handshake failure stays sanitized and closes the owned client',async(t)=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
 const {runVkConnectorOperatorPreflight}=require('../../dist/workers/vk_connector_consumer.js');let closes=0;
 t.mock.method(Client.prototype,'connect',async()=>{throw Error('private-sdk-error');});
 t.mock.method(Client.prototype,'close',async()=>{closes++;});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vk143-sdk-'));const file=path.join(dir,'config.json');
 const key='CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN',old=process.env[key];const write=process.stdout.write;let out='';
 try{
  fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});process.env[key]='offline-readiness-fixture';
  process.stdout.write=function(value){out+=String(value);return true;};
  await runVkConnectorOperatorPreflight(file,new AbortController().signal);
 }finally{process.stdout.write=write;if(old===undefined)delete process.env[key];else process.env[key]=old;fs.rmSync(dir,{recursive:true,force:true});}
 const r=JSON.parse(out);assert.equal(r.status,'BLOCKED');assert.equal(r.productionReady,false);assert.equal(out.includes('private-sdk-error'),false);assert.equal(closes,1);
});
