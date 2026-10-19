const path=require('node:path');const assert=require('node:assert/strict');const {server,pkg,claim}=require('./server.cjs');
function assertBrowsersClosed(){const fs=require('node:fs');for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))){let comm,stat;try{comm=fs.readFileSync(`/proc/${pid}/comm`,'utf8');stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');}catch{continue;}if(/chrome|chromium/.test(comm)&&!stat.slice(stat.lastIndexOf(')')+2).startsWith('Z '))assert.fail('native browser process survived cleanup: '+JSON.stringify({pid:Number(pid),state:stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],parent:Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]),group:Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[2]),start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}));}}
const child=path.resolve('tests/fixtures/owned-publication-native/child.cjs');
function registered(base,local,mode='normal'){
 const {invokeOwnedPublicationProcess}=require(path.join(base,'services/owned_publication_adapter_process.js'));
 const registration={executable:child,modulePath:'/app/node_modules',browserPath:'/opt/playwright'};
 const calls=[];
 return {calls,async invoke(operation,p,c,hooks={beforeMutation:async()=>{calls.push('mutation');},beforeSubmit:async observation=>{calls.push('submit');c.nativeObjectId=observation.objectId;}},signal,deadline){
  const pid=process.pid;let value;try{value=await invokeOwnedPublicationProcess(registration,{operation,package:p,claim:c},{cookies:`fixture_port=${local.port};fixture_mode=${mode}`},hooks,signal,deadline);}catch(error){let diagnostic='';try{diagnostic=require('node:fs').readFileSync('/tmp/owned-native-fixture-error.txt','utf8');}catch{}throw Error(error.message+' '+diagnostic);}
  assert.equal(process.pid,pid);assertBrowsersClosed();return value;
 }};
}
async function runNativeScenarios(base){const local=await server();let submits=0,readbacks=0;try{
 for(const n of [701,911]){const p=pkg(n),c=claim(p),adapter=registered(base,local);
  const inventory=await adapter.invoke('inventory',p);assert.equal(inventory.complete,true);assert.equal(inventory.absent,true);assert.equal(inventory.accountId,p.accountId);
  const receipt=await adapter.invoke('publish',p,c);assert.equal(receipt.accountId,p.accountId);assert.equal(receipt.packageDigest,p.digest);assert.equal(receipt.bodySha256,p.bodySha256);assert.equal(receipt.assetSha256,p.assetSha256);assert.equal(receipt.objectId,c.nativeObjectId);
  assert.deepEqual(adapter.calls,['mutation','submit']);assert.equal(local.uploads,++submits);
  const readback=await adapter.invoke('readback',p,c);assert.equal(readback.objectId,receipt.objectId);assert.equal(readback.url,receipt.url);readbacks++;
  const after=await adapter.invoke('inventory',p);assert.equal(after.absent,false);
 }
 assert.equal(local.submits,2);assert.equal(local.unexpected,0);for(const request of local.requests.filter(r=>r.method==='POST'&&(r.path.endsWith('/publication')||r.path.endsWith('/publish')))){assert.equal(request.contentType,'application/json');assert.deepEqual(JSON.parse(request.body),request.path.endsWith('/publication')?{kind:'native-ui-create'}:{objectId:request.path.split('/').at(-2)});}
 return {packages:2,submits:local.submits,readbacks,sandbox:true,externalRequests:local.unexpected,childrenClosed:true};
 }finally{await local.close();}}
async function runDoubleCreateScenarios(base){const local=await server();try{local.duplicateCreate=true;const p=pkg(2601),c=claim(p);await assert.rejects(registered(base,local).invoke('publish',p,c),/OWNED_NATIVE/);assert.equal(local.objects.size,1);assert.equal(local.submits,0);assertBrowsersClosed();return {drafts:1,providerSubmits:0};}finally{await local.close();}}
async function runStartupCrashScenarios(base){const local=await server();try{const fs=require('node:fs');fs.rmSync('/tmp/owned-native-startup-killed',{force:true});const start=Date.now();await assert.rejects(registered(base,local,'crash_during_start').invoke('inventory',pkg(2401)),/OWNED_NATIVE/);assert.equal(fs.readFileSync('/tmp/owned-native-startup-killed','utf8'),'before_resource_ack');assertBrowsersClosed();assert.ok(Date.now()-start<10000);assert.equal(local.requests.length,0);return {startupClosed:true,nativeRequests:0};}finally{await local.close();}}
async function runDoubleSubmitScenarios(base){const local=await server();try{local.duplicateSubmit=true;const p=pkg(2201),c=claim(p),adapter=registered(base,local);await assert.rejects(adapter.invoke('publish',p,c),/OWNED_NATIVE/);assert.equal(local.submits,1);assertBrowsersClosed();return {providerSubmits:local.submits,uncertain:true};}finally{await local.close();}}
async function runBudgetScenarios(base){const local=await server();try{
 const p=pkg(1801),c=claim(p),adapter=registered(base,local),controller=new AbortController(),start=Date.now(),deadline=start+4000;
 await adapter.invoke('inventory',p,undefined,undefined,controller.signal,deadline);
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now()-250)));
 await assert.rejects(adapter.invoke('publish',p,c,undefined,controller.signal,deadline),/OWNED_NATIVE/);assert.equal(local.submits,0);assertBrowsersClosed();assert.ok(Date.now()-start<14000);
 const invoke=require(path.join(base,'services/owned_publication_adapter_process.js')).invokeOwnedPublicationProcess;let read=false;const secret={};Object.defineProperty(secret,'cookies',{get(){read=true;throw Error('secret access');}});
 await assert.rejects(invoke({executable:child,modulePath:'/app/node_modules'},{operation:'inventory',package:p},secret,{beforeMutation:async()=>{},beforeSubmit:async()=>{}},undefined,Date.now()-1),/OWNED_NATIVE_CANCELLED/);assert.equal(read,false);
 const cancelled=new AbortController();let hookDone=false;
 await assert.rejects(adapter.invoke('publish',p,c,{beforeMutation:async()=>{setTimeout(()=>cancelled.abort(),25);await new Promise(resolve=>setTimeout(resolve,150));hookDone=true;},beforeSubmit:async()=>assert.fail('Submit after cancellation')},cancelled.signal,Date.now()+10000),/OWNED_NATIVE/);assert.equal(hookDone,true);assert.equal(local.submits,0);assertBrowsersClosed();
 return {sharedDeadline:true,callbacksJoined:true,secretRead:false};
 }finally{await local.close();}}
async function runFailureScenarios(base){const local=await server();let secretLeaked=false;try{
 const p=pkg(1201),c=claim(p),adapter=registered(base,local);
 const {invokeOwnedPublicationProcess}=require(path.join(base,'services/owned_publication_adapter_process.js'));
 await assert.rejects(invokeOwnedPublicationProcess({executable:path.resolve('tests/fixtures/owned-publication-native/hostile-child.cjs'),modulePath:'/app/node_modules'},{operation:'inventory',package:p},{cookies:'synthetic-only'},{beforeMutation:async()=>assert.fail('invalid peer reached mutation'),beforeSubmit:async()=>assert.fail('invalid peer reached Submit')}),/OWNED_NATIVE/);
 await assert.rejects(adapter.invoke('publish',p,c,{beforeMutation:async()=>{throw Error('denied');},beforeSubmit:async()=>{throw Error('denied');}}),/OWNED_NATIVE/);assert.equal(local.submits,0);const denied=local.submits;
 const controller=new AbortController();const cancelled=registered(base,local,'stall').invoke('inventory',p,undefined,undefined,controller.signal);setTimeout(()=>controller.abort(),1500);await assert.rejects(cancelled,/OWNED_NATIVE_CANCELLED/);
 try{await registered(base,local,'crash').invoke('inventory',p);}catch(error){secretLeaked=error.message.includes('synthetic-sensitive');assert.match(error.message,/OWNED_NATIVE/);}
 await assert.rejects(registered(base,local,'crash_after_start').invoke('inventory',p),/OWNED_NATIVE/);assertBrowsersClosed();
 local.wrongProof=true;await assert.rejects(adapter.invoke('publish',p,c),/OWNED_NATIVE/);assert.equal(local.submits,0);
 local.wrongProof=false;local.corruptPublishedCover=true;const recoveredPackage=pkg(1401),recoveredClaim=claim(recoveredPackage);
 await assert.rejects(adapter.invoke('publish',recoveredPackage,recoveredClaim),/OWNED_NATIVE/);assert.equal(local.submits,1);assert.ok(recoveredClaim.nativeObjectId);
 local.corruptPublishedCover=false;const receipt=await adapter.invoke('readback',recoveredPackage,recoveredClaim);assert.equal(receipt.objectId,recoveredClaim.nativeObjectId);assert.equal(local.submits,1);assertBrowsersClosed();
 return {submitsAfterDenied:denied,uncertain:true,childrenClosed:true,secretLeaked};
 }finally{await local.close();}}
module.exports={runNativeScenarios,runFailureScenarios,runBudgetScenarios,runDoubleSubmitScenarios,runStartupCrashScenarios,runDoubleCreateScenarios};

async function runTransportBounds(base){for(const mode of ['oversize','redirect']){const local=await server();try{local.createResponseMode=mode;const p=pkg(2801);await assert.rejects(registered(base,local).invoke('publish',p,claim(p)),/OWNED_NATIVE/);assert.equal(local.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/publication')).length,1);assert.equal(local.submits,0);assert.equal(local.objects.size,0);assertBrowsersClosed();}finally{await local.close();}}return {singleRequest:true,noSubmit:true,bounded:true};}
module.exports.runTransportBounds=runTransportBounds;

async function runSubmitTransportBounds(base){for(const mode of ['oversize','redirect']){const local=await server();try{local.submitResponseMode=mode;const p=pkg(2901),c=claim(p),adapter=registered(base,local);await assert.rejects(adapter.invoke('publish',p,c),/OWNED_NATIVE/);assert.equal(local.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/publish')).length,1);assert.equal(local.submits,1);assert.equal(local.objects.size,1);assert.ok(c.nativeObjectId);local.submitResponseMode='normal';const receipt=await adapter.invoke('readback',p,c);assert.equal(receipt.objectId,c.nativeObjectId);assert.equal(local.submits,1);assertBrowsersClosed();}finally{await local.close();}}return {singleSubmit:true,reconciliationOnly:true};}
module.exports.runSubmitTransportBounds=runSubmitTransportBounds;

async function runFreshProof(base){const local=await server();try{local.corruptPublishedBody=true;const p=pkg(3101),c=claim(p);await assert.rejects(registered(base,local).invoke('publish',p,c),/OWNED_NATIVE/);assert.equal(local.submits,1);assert.equal(local.objects.get(c.nativeObjectId).body,'unexpected native persisted body');assertBrowsersClosed();return {freshBody:true,providerSubmits:1};}finally{await local.close();}}
module.exports.runFreshProof=runFreshProof;

async function runAwaitedSubmitProof(base){const local=await server();try{const p=pkg(3301),c=claim(p),digest=c.package.digest;let bound;await assert.rejects(registered(base,local).invoke('publish',p,c,{beforeMutation:async()=>{},beforeSubmit:async observation=>{c.nativeObjectId=observation.objectId;bound=observation.objectId;await new Promise(resolve=>setTimeout(resolve,25));local.objects.get(bound).body='provider body changed during awaited fence';}}),/OWNED_NATIVE/);assert.equal(local.submits,0);assert.equal(local.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/publish')).length,0);assert.equal(c.nativeObjectId,bound);assert.equal(c.package.digest,digest);assert.equal(local.objects.size,1);assertBrowsersClosed();return {providerSubmits:0,originalBindingHeld:true};}finally{await local.close();}}
module.exports.runAwaitedSubmitProof=runAwaitedSubmitProof;

async function runPendingAutosaveProof(base){const local=await server();try{local.delayedAutosave=true;const p=pkg(3501),c=claim(p);await assert.rejects(registered(base,local).invoke('publish',p,c,{beforeMutation:async()=>{},beforeSubmit:async observation=>{c.nativeObjectId=observation.objectId;const limit=Date.now()+1000;while(!local.pendingAutosave&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(local.pendingAutosave,true);local.releaseDelayed();}}),/OWNED_NATIVE/);assert.equal(local.submits,0);assert.equal(local.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/publish')).length,0);assert.equal(local.objects.get(c.nativeObjectId).body,'delayed autosave changed native body');assertBrowsersClosed();return {providerSubmits:0,pendingWriteDrained:true};}finally{await local.close();}}
module.exports.runPendingAutosaveProof=runPendingAutosaveProof;
