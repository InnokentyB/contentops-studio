import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateBrowserRecovery } from '../services/browser_recovery_coordinator';
import type { BrowserRecoveryRepository, RecoveryReservation, RecoveryOutcome, RecoveryContext, RecoveryClock, BrowserRecoveryPorts } from '../services/browser_recovery_contract';
const digest='a'.repeat(64);
const context:RecoveryContext={scope:{projectId:1,taskId:2,attemptId:3,packageSha256:digest},provider:'synthetic',accountSha256:digest,bodySha256:digest,assetSha256:null,publishedAfterMs:0,publishedBeforeMs:999999};
function harness(){
 let now=1000,round=0,requests=0,settles=0;const timers:Array<()=>void>=[];
 const clock:RecoveryClock={now:()=>now,wait:async(ms,signal)=>{if(signal.aborted)throw Error('cancelled');now+=ms;},timer:(_ms,callback)=>{timers.push(callback);return ()=>{const i=timers.indexOf(callback);if(i>=0)timers.splice(i,1);};}};
 const repository:BrowserRecoveryRepository={reserve:async scope=>round>=3||requests>=20?{kind:'exhausted'}:{kind:'reserved',reservation:{scope,rowVersion:round,executionGeneration:1,leaseToken:'private-lease',startedAtMs:1000,deadlineMs:181000,round:++round,requestsUsed:requests}},takeRequest:async()=>{if(requests>=20)return false;requests++;return true;},settle:async(_reservation,_outcome)=>{settles++;return 'committed';}};
 const ports:BrowserRecoveryPorts=new Map();
 return {clock,repository,ports,timers,stats:()=>({round,requests,settles}),advance:(ms:number)=>{now+=ms;for(const timer of [...timers])timer();}};
}
test('unsupported reader reports honest capability gap without database admission',async()=>{
 const h=harness();const result=await coordinateBrowserRecovery(context,{...h,finalize:async()=>{throw Error('must not finalize');}});
 assert.equal(result.code,'READBACK_CAPABILITY_UNAVAILABLE');assert.deepEqual(h.stats(),{round:0,requests:0,settles:0});assert.equal(result.retry_allowed,false);assert.equal(result.submission_permitted,false);
});
test('temporary read failures retry within durable round budget without owner consent',async()=>{
 const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_context,control)=>{assert.equal(await control.takeRequest(),true);throw Error('private-token');},verify:async()=>undefined});
 const result=await coordinateBrowserRecovery(context,{...h,finalize:async()=>{throw Error('never');}});
 assert.equal(result.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal(h.stats().round,3);assert.equal(h.stats().requests,3);assert.equal(JSON.stringify(result).includes('private'),false);
 const replay=await coordinateBrowserRecovery(context,{...h,finalize:async()=>{throw Error('never');}});assert.equal(replay.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal(h.stats().round,3);
});
const noFinalizer=async()=>{throw Error('unexpected finalization');};
const evidence={schemaVersion:1,provider:'synthetic',accountSha256:digest,packageSha256:digest,bodySha256:digest,assetSha256:null,providerObjectId:'object',publicUrl:'https://synthetic.invalid/post',publishedAtMs:500,observedAtMs:1000,evidenceRef:'sha256:'+digest};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('FOUND uses registered verification and single atomic finalizer, never separate settlement',async()=>{
 const h=harness();let verified=0,finalized=0;
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind:'FOUND',evidence:{private:'untrusted candidate'}};},verify:async()=>{verified++;return evidence;}});
 const result=await coordinateBrowserRecovery(context,{...h,finalize:async(r,e,o,signal)=>{assert.equal(signal.aborted,false);assert.equal(r.scope.attemptId,3);assert.equal(e.providerObjectId,'object');assert.equal(o.retry_allowed,false);finalized++;return 'finalized';}});
 assert.equal(result.code,'RECONCILIATION_FOUND');assert.equal(result.deliveryCertainty,'CONFIRMED_SENT');assert.equal(verified,1);assert.equal(finalized,1);assert.equal(h.stats().settles,0);assert.equal(JSON.stringify(result).includes('synthetic.invalid'),false);
});
test('malformed mismatching or stale verified evidence cannot finalize',async()=>{
 for(const changed of [{bodySha256:'b'.repeat(64)},{accountSha256:'b'.repeat(64)},{packageSha256:'b'.repeat(64)},{assetSha256:digest},{publishedAtMs:-1},{observedAtMs:-1},{publicUrl:'https://user:private@synthetic.invalid/post'},{privateToken:'private'}]){
  const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind:'FOUND',evidence};},verify:async()=>({...evidence,...changed})});
  const result=await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});assert.equal(result.code,'RECONCILIATION_COVERAGE_INCOMPLETE');assert.equal(result.deliveryCertainty,'UNKNOWN');assert.equal(JSON.stringify(result).includes('private'),false);
 }
});
test('provider request budget stops at twenty even if reader requests a hundred pages',async()=>{
 const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{for(let i=0;i<100;i++)if(!await control.takeRequest())break;return {kind:'NOT_FOUND'};},verify:async()=>undefined});
 const result=await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});assert.equal(result.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal(h.stats().requests,20);assert.equal(h.stats().round,1);
});
test('NOT_FOUND retries finitely and incomplete ambiguous strong non-delivery claims never permit resend',async()=>{
 for(const kind of ['NOT_FOUND','COVERAGE_INCOMPLETE','AMBIGUOUS','PROVEN_NOT_SENT']){
  const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind};},verify:async()=>undefined});
  const result=await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});assert.equal(result.deliveryCertainty,'UNKNOWN');assert.equal(result.retry_allowed,false);assert.equal(result.submission_permitted,false);assert.equal(h.stats().round,kind==='NOT_FOUND'?3:1);
 }
});
test('abort cancels active port, persists safe UNKNOWN and blocks later request permits',async()=>{
 const h=harness(),abort=new AbortController();let controlSeen:Parameters<NonNullable<ReturnType<typeof h.ports.get>>['read']>[1]|undefined;
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{controlSeen=control;await control.takeRequest();return new Promise(()=>undefined);},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,signal:abort.signal,finalize:noFinalizer});await flush();abort.abort();const result=await pending;
 assert.equal(result.code,'RECONCILIATION_CANCELLED');assert.equal(controlSeen?.signal.aborted,true);assert.equal(await controlSeen!.takeRequest(),false);assert.equal(h.stats().settles,1);
});
test('port timeout aborts a hung lookup and remaining attempts are bounded',async()=>{
 const h=harness();let calls=0,firstSignal:AbortSignal|undefined;
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();calls++;if(calls===1){firstSignal=control.signal;return new Promise(()=>undefined);}return {kind:'TEMPORARY_UNAVAILABLE'};},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});await flush();h.advance(1000);const result=await pending;
 assert.equal(firstSignal?.aborted,true);assert.equal(calls,3);assert.equal(result.code,'RECONCILIATION_BUDGET_EXHAUSTED');
});
test('concurrent lease holder prevents duplicate reads and stale settlement returns held conflict',async()=>{
 const h=harness();const reserve=h.repository.reserve;let held=false,reads=0;const abort=new AbortController();
 h.repository.reserve=async(scope,now)=>{if(held)return {kind:'held'};held=true;return reserve(scope,now);};
 h.repository.settle=async()=> 'conflict';
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();reads++;return new Promise(()=>undefined);},verify:async()=>undefined});
 const first=coordinateBrowserRecovery(context,{...h,signal:abort.signal,finalize:noFinalizer});await flush();
 const second=await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});assert.equal(second.code,'RECOVERY_IN_PROGRESS');assert.equal(reads,1);abort.abort();assert.equal((await first).code,'RECOVERY_CONFLICT');
});
test('finalization rejection preserves owner/package/permission blocker and no replacement fact writes',async()=>{
 for(const [final,code] of [['approval_revoked','APPROVAL_REVOKED'],['package_changed','PACKAGE_CHANGED'],['permission_denied','PERMISSION_DENIED'],['conflict','RECOVERY_CONFLICT']] as const){
  const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind:'FOUND',evidence};},verify:async()=>evidence});
  const result=await coordinateBrowserRecovery(context,{...h,finalize:async()=>final});assert.equal(result.code,code);assert.equal(result.deliveryCertainty,'UNKNOWN');assert.equal(h.stats().settles,1);
 }
});
test('invalid scope and legacy state cause zero provider reads',async()=>{
 const h=harness();let calls=0;h.ports.set('synthetic',{timeoutMs:1000,read:async()=>{calls++;return {};},verify:async()=>undefined});
 assert.equal((await coordinateBrowserRecovery({...context,scope:{...context.scope,projectId:-1}},{...h,finalize:noFinalizer})).code,'RECOVERY_INPUT_INVALID');
 h.repository.reserve=async()=>({kind:'legacy'});assert.equal((await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer})).code,'RECOVERY_LEGACY_UNKNOWN');assert.equal(calls,0);
});
test('hung repository reserve is bounded by operation deadline and abort',async()=>{
 const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async()=>{throw Error('never');},verify:async()=>undefined});h.repository.reserve=async()=>new Promise(()=>undefined);
 const pending=coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});await flush();h.advance(180000);assert.equal((await pending).code,'RECONCILIATION_BUDGET_EXHAUSTED');
});
test('signed URL queries and control characters in known object identity are rejected',async()=>{
 const h=harness();h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind:'FOUND',evidence};},verify:async()=>({...evidence,publicUrl:'https://synthetic.invalid/post?token=private'})});
 assert.equal((await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer})).code,'RECONCILIATION_COVERAGE_INCOMPLETE');
 assert.equal((await coordinateBrowserRecovery({...context,knownObjectId:'object\nprivate'},{...h,finalize:noFinalizer})).code,'RECOVERY_INPUT_INVALID');
});
test('overall deadline cancels hanging request accounting without allowing late provider requests',async()=>{
 const h=harness();let permit:Promise<boolean>|undefined;
 h.repository.takeRequest=async()=>new Promise(()=>undefined);
 h.ports.set('synthetic',{timeoutMs:180000,read:async(_c,control)=>{permit=control.takeRequest();await permit;return {kind:'NOT_FOUND'};},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});await flush();h.advance(180000);assert.equal((await pending).code,'RECONCILIATION_BUDGET_EXHAUSTED');
 assert.equal(h.stats().round,1);
});
test('settlement timeout returns conflict without starting another reader',async()=>{
 const h=harness();let reads=0;
 h.repository.settle=async()=>new Promise(()=>undefined);
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{reads++;await control.takeRequest();return {kind:'NOT_FOUND'};},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});await flush();h.advance(5000);assert.equal((await pending).code,'RECOVERY_CONFLICT');assert.equal(reads,1);
});
test('abort while waiting between rounds does not perform another provider read',async()=>{
 const h=harness(),abort=new AbortController();let reads=0;
 h.clock.wait=async()=>new Promise(()=>undefined);
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{reads++;await control.takeRequest();return {kind:'NOT_FOUND'};},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,signal:abort.signal,finalize:noFinalizer});await flush();abort.abort();const result=await pending;assert.equal(result.code,'RECONCILIATION_CANCELLED');assert.equal(reads,1);
});
test('ambiguous observations cannot be upgraded by verification or sent to finalizer',async()=>{
 const h=harness();let verified=0;
 h.ports.set('synthetic',{timeoutMs:1000,read:async(_c,control)=>{await control.takeRequest();return {kind:'AMBIGUOUS',evidence};},verify:async()=>{verified++;return evidence;}});
 const result=await coordinateBrowserRecovery(context,{...h,finalize:noFinalizer});assert.equal(result.code,'RECONCILIATION_AMBIGUOUS');assert.equal(verified,0);
});
test('abort during initial reservation returns promptly without provider reads',async()=>{
 const h=harness(),abort=new AbortController();h.repository.reserve=async()=>new Promise(()=>undefined);
 h.ports.set('synthetic',{timeoutMs:1000,read:async()=>{throw Error('must not read');},verify:async()=>undefined});
 const pending=coordinateBrowserRecovery(context,{...h,signal:abort.signal,finalize:noFinalizer});await flush();abort.abort();assert.equal((await pending).code,'RECONCILIATION_CANCELLED');
});
test('unknown outcome code cannot leak raw data or crash diagnostic factory',async()=>{
 const {recoveryOutcome}=await import('../services/browser_recovery_coordinator');
 const result=recoveryOutcome('private-token');assert.equal(result.code,'RECOVERY_CONFLICT');assert.equal(JSON.stringify(result).includes('private-token'),false);
});
