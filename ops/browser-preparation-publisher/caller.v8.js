/* Portable outer-executor caller. No Node, AbortController, native kill or detached provider work. */
function createPublisherPreparationCaller(options) {
 const {binding,planner,native,clock={now:()=>Date.now(),setTimeout,clearTimeout},heartbeatIntervalMs=10000,controlTimeoutMs=10000}=options||{};
 const fail=code=>new Error('['+code+']');
 if(!binding||['projectId','taskId','attemptId','workItemId'].some(k=>!Number.isSafeInteger(binding[k])||binding[k]<1)||!Number.isSafeInteger(binding.generation)||binding.generation<0)throw fail('CALLER_BINDING_INVALID');
 if(!planner||['heartbeat','preSubmit','beginDispatch','markUncertain'].some(k=>typeof planner[k]!=='function')||!native||['prepareAndAwaitTerminal','postAndAwaitTerminal'].some(k=>typeof native[k]!=='function'))throw fail('CALLER_PORT_UNBOUND');
 if(!Number.isFinite(options.leaseExpiresAtMs)||!Number.isSafeInteger(heartbeatIntervalMs)||heartbeatIntervalMs<1||heartbeatIntervalMs>30000||!Number.isSafeInteger(controlTimeoutMs)||controlTimeoutMs<1||controlTimeoutMs>30000||['now','setTimeout','clearTimeout'].some(k=>typeof clock[k]!=='function'))throw fail('CALLER_BINDING_INVALID');
 const bound=Object.freeze({...binding});let expiry=options.leaseExpiresAtMs,state='idle',beatTimer,expiryTimer,beating=null,nativePending=null,stopCode=null;
 const clear=()=>{clock.clearTimeout(beatTimer);clock.clearTimeout(expiryTimer);beatTimer=undefined;expiryTimer=undefined;};
 const live=()=>Number.isFinite(clock.now())&&clock.now()<expiry;
 const stop=code=>{if(!stopCode)stopCode=code;clear();};
 const armExpiry=()=>{clock.clearTimeout(expiryTimer);expiryTimer=clock.setTimeout(()=>stop('LEASE_EXPIRED'),Math.max(0,expiry-clock.now()));};
 const schedule=()=>{if(state==='preparing'&&!stopCode)beatTimer=clock.setTimeout(()=>{void tick();},heartbeatIntervalMs);};
 async function control(run,deadline,code,maxWaitMs=controlTimeoutMs){
  let timer;const wait=Math.min(maxWaitMs,deadline-clock.now());
  if(!Number.isFinite(wait)||wait<=0)throw fail(code);
  try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=clock.setTimeout(()=>reject(fail(code)),wait);})]);}
  finally{clock.clearTimeout(timer);}
 }
 async function beat(){
  if(!live())throw fail('LEASE_EXPIRED');const previous=expiry;
  const reply=await control(()=>planner.heartbeat(bound),previous,'HEARTBEAT_REJECTED');
  if(stopCode||clock.now()>=previous||!reply||reply.generation!==bound.generation||!Number.isFinite(reply.leaseExpiresAtMs)||reply.leaseExpiresAtMs<previous||reply.leaseExpiresAtMs<=clock.now()||reply.submission_permitted!==false||reply.retry_allowed!==false)throw fail('HEARTBEAT_REJECTED');
  expiry=reply.leaseExpiresAtMs;armExpiry();
 }
 async function tick(){
  if(state!=='preparing'||stopCode||beating)return;
  beating=beat().catch(()=>stop('HEARTBEAT_REJECTED')).finally(()=>{beating=null;schedule();});await beating;
 }
 function terminal(value){
  if(!value||value.status!=='completed'||typeof value.callId!=='string'||!value.callId||value.callId.length>200||!/^([a-f0-9]{64})$/.test(value.inputSha256)||!/^([a-f0-9]{64})$/.test(value.evidenceSha256))throw fail('NATIVE_TERMINAL_UNVERIFIED');
  return {callId:value.callId,inputSha256:value.inputSha256,evidenceSha256:value.evidenceSha256};
 }
 async function prepare(registeredOperation){
  if(stopCode||state==='held')throw fail('CALLER_HELD');
  if(!['idle','prepared'].includes(state))throw fail('CALLER_NOT_IDLE');
  if(typeof registeredOperation!=='string'||!registeredOperation||registeredOperation.length>200)throw fail('CALLER_OPERATION_INVALID');
  state='preparing';
  try{
   armExpiry();await beat();if(stopCode)throw fail(stopCode);schedule();
   // This port MUST await the real terminal native receipt. A yielded/running result is rejected.
   nativePending=Promise.resolve().then(()=>{
    if(stopCode||!live())throw fail(stopCode||'LEASE_EXPIRED');
    return native.prepareAndAwaitTerminal(registeredOperation,bound);
   });
   const observation=terminal(await nativePending);nativePending=null;
   if(beating)await beating;
   if(stopCode)throw fail(stopCode);if(!live())throw fail('LEASE_EXPIRED');
   state='prepared';return {state,attemptId:bound.attemptId,generation:bound.generation,observation,nativeQueueDrainProven:false,submissionPermitted:false};
  }catch(error){state='held';if(!stopCode)stopCode=error instanceof Error&&/^\[(LEASE_EXPIRED|HEARTBEAT_REJECTED|NATIVE_TERMINAL_UNVERIFIED)\]$/.test(error.message)?error.message.slice(1,-1):'PREPARATION_FAILED';throw fail(stopCode);}
  finally{clear();}
 }
 async function dispatch(){
  if(state!=='prepared'||stopCode)throw fail('CALLER_NOT_PREPARED');
  state='permit_requested';clear();
  if(!live()){state='held';stop('LEASE_EXPIRED');throw fail('LEASE_EXPIRED');}
  try{
   const permit=await control(()=>planner.preSubmit(bound),expiry,'POST_SUBMIT_UNKNOWN'),until=Date.parse(permit?.permit_expires_at);
   if(stopCode||permit?.submission_permitted!==true||!Number.isFinite(until)||clock.now()>=until||!live())throw fail('POST_SUBMIT_UNKNOWN');
   const boundary=await control(()=>planner.beginDispatch(bound),Math.min(expiry,until),'POST_SUBMIT_UNKNOWN');
   if(stopCode||boundary?.dispatch_authorized!==true||clock.now()>=until||!live())throw fail('POST_SUBMIT_UNKNOWN');
   state='dispatch_started';
   nativePending=Promise.resolve().then(()=>{
    if(stopCode||clock.now()>=until||!live())throw fail('POST_SUBMIT_UNKNOWN');
    return native.postAndAwaitTerminal(bound);
   });
   // A bounded outcome wait never cancels the actual Post or permits a second one.
   const observation=terminal(await control(()=>nativePending,Math.min(expiry,clock.now()+30000),'POST_SUBMIT_UNKNOWN',30000));nativePending=null;state='awaiting_result';
   return {state,attemptId:bound.attemptId,generation:bound.generation,observation,submissionPermitted:false};
  }catch{
   state='held';stop('POST_SUBMIT_UNKNOWN');
   try{await control(()=>planner.markUncertain(bound),clock.now()+controlTimeoutMs,'RECONCILIATION_RECORD_UNCONFIRMED');}catch{throw fail('RECONCILIATION_RECORD_UNCONFIRMED');}
   throw fail('POST_SUBMIT_UNKNOWN');
  }
 }
 async function stopNewActionsAndJoin(){
  stop('CALLER_HELD');
  try{if(nativePending)terminal(await nativePending);if(beating)await beating;}
  catch{throw fail('NATIVE_TERMINAL_UNVERIFIED');}
  state='held';return {state,attemptId:bound.attemptId,generation:bound.generation,nativeQueueDrainProven:false,submissionPermitted:false};
 }
 return Object.freeze({prepare,dispatch,stopNewActionsAndJoin});
}
if(typeof module!=='undefined')module.exports={createPublisherPreparationCaller};
