const {createHash}=require('node:crypto');
const {classifyExternalExec,canonicalArgumentsSha256}=require('../terminal-external-census-20261026/census.cjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
function argumentObject(value){if(typeof value==='string'){try{return object(JSON.parse(value));}catch{return null;}}return object(value);}
function resultObject(value,depth=0){
 if(depth>5)return null;
 if(typeof value==='string'){try{return resultObject(JSON.parse(value),depth+1);}catch{return null;}}
 const v=object(value);if(!v||v.isError===true)return null;
 if(Number.isSafeInteger(v.attempt_id))return v;
 if(v.structuredContent)return resultObject(v.structuredContent,depth+1);
 if(Array.isArray(v.content)&&v.content.length===1&&v.content[0]?.type==='text')return resultObject(v.content[0].text,depth+1);
 return null;
}
function finalExec(value,depth=0){
 if(depth>4)return false;
 if(typeof value==='string'){
  if(/^Script completed(?:\r?\n|$)/.test(value))return true;
  try{return finalExec(JSON.parse(value),depth+1);}catch{return false;}
 }
 const v=object(value);return !!v&&v.isError!==true&&Array.isArray(v.content)&&v.content.length===1&&v.content[0]?.type==='text'&&finalExec(v.content[0].text,depth+1);
}
/** Pure local adapter. Missing native arguments/results/completion never acquire invented defaults. */
function createNativeSourceIndex(scope){
 const frames=new Map(),leaves=new Map(),declarations=new Map(),outputs=new Map(),wireKinds=new Map();
 function observe(row){
  const p=row.payload??{},target=p.turn_id===scope.turnId,decl=p.internal_chat_message_metadata_passthrough?.turn_id===scope.turnId;
  if(target||decl){const raw=[row.type,p.type,p.item?.type].filter(Boolean).join(':'),kind=/^[A-Za-z_:]{1,180}$/.test(raw)?raw:'UNRECOGNIZED';if(!wireKinds.has(kind)&&wireKinds.size>=100)throw Error('TERMINAL_NATIVE_FRAME_LIMIT');wireKinds.set(kind,(wireKinds.get(kind)??0)+1);}
  if(row.type==='response_item'&&decl&&['custom_tool_call','function_call'].includes(p.type)){
   if(p.type==='custom_tool_call'||(p.namespace!=='mcp__cua_repl'||p.name!=='js')){
    if(frames.size>=200||frames.has(p.call_id))throw Error('TERMINAL_NATIVE_FRAME_INVALID');
    const rawInput=typeof p.input==='string'?p.input:typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments??null);
    if(Buffer.byteLength(rawInput)>262144)throw Error('TERMINAL_NATIVE_FRAME_LIMIT');
    frames.set(p.call_id,{callId:p.call_id,ordinal:row.ordinal,namespace:p.namespace??null,toolName:p.name,rawInput,completion:null});
   }
   if(p.type==='function_call')declarations.set(p.call_id,{arguments:p.arguments,namespace:p.namespace,tool:p.name});
  }
  if(row.type==='event_msg'&&target&&p.type==='item_completed'&&p.item?.type==='McpToolCall'){
   const item=p.item;if(leaves.size>=400||leaves.has(item.id)||p.thread_id!==scope.threadId)throw Error('TERMINAL_NATIVE_FRAME_INVALID');
   const d=declarations.get(item.id),args=argumentObject(item.arguments??d?.arguments);
   let argumentsSha256=null;try{if(args)argumentsSha256=canonicalArgumentsSha256(args);}catch{argumentsSha256=null;}
   const result=resultObject(item.result??outputs.get(item.id));
   leaves.set(item.id,{callId:item.id,ordinal:row.ordinal,server:item.server,tool:item.tool,status:item.status,argumentsSha256,
    ...(typeof item.parentCallId==='string'?{parentCallId:item.parentCallId}:{}),
    resultAttemptId:result?.attempt_id,resultSubmissionPermitted:result?.submission_permitted,resultRetryAllowed:result?.retry_allowed,
    privateStartArguments:item.tool==='ba_start_browser_submission'?args:null});
  }
  if(row.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)){
   if(frames.has(p.call_id)){const frame=frames.get(p.call_id);if(frame.completion)throw Error('TERMINAL_NATIVE_FRAME_INVALID');frame.completion={callId:p.call_id,ordinal:row.ordinal,status:finalExec(p.output)?'completed':'unknown'};}
   if(declarations.has(p.call_id)||leaves.has(p.call_id)){
    outputs.set(p.call_id,p.output);const leaf=leaves.get(p.call_id),result=resultObject(p.output);
    if(leaf&&result){leaf.resultAttemptId=result.attempt_id;leaf.resultSubmissionPermitted=result.submission_permitted;leaf.resultRetryAllowed=result.retry_allowed;}
   }
  }
 }
 function finish({startOrdinal,endOrdinal,cuaCallIds}){
  const binding=scope.targetBinding,cua=new Set(cuaCallIds),all=[...leaves.values()].filter(v=>!cua.has(v.callId)),used=new Set();
  const candidates=all.filter(v=>{
   const a=v.privateStartArguments;if(!binding||!a||v.status!=='completed'||v.resultAttemptId!==binding.attemptId||v.resultSubmissionPermitted!==false||v.resultRetryAllowed!==false)return false;
   try{return a.projectId===binding.projectId&&a.taskId===binding.taskId&&a.workItemId===binding.workItemId&&a.actorId===binding.actorId&&typeof a.idempotencyKey==='string'&&sha(a.idempotencyKey.trim())===binding.keySha256&&typeof a.leaseToken==='string'&&sha(a.leaseToken)===binding.leaseSha256&&canonicalArgumentsSha256(a.snapshot)===binding.snapshotSha256&&typeof a.approvalReference==='string'&&(!binding.approvalSha256||sha(a.approvalReference)===binding.approvalSha256);}catch{return false;}
  }).sort((a,b)=>a.ordinal-b.ordinal);
  const servers=new Set(candidates.map(v=>v.server)),original=servers.size===1?candidates[0]:null,external=[];
  for(const frame of frames.values()){
   const end=frame.completion?.ordinal??endOrdinal;
   const overlapping=[...frames.values()].some(f=>f!==frame&&f.ordinal<end&&(f.completion?.ordinal??endOrdinal)>frame.ordinal);
   const native=all.filter(v=>v.ordinal>frame.ordinal&&v.ordinal<end);
   for(const v of native)used.add(v.callId);
   const nativeBindings=native.map(({privateStartArguments,...v})=>v);
   const semantic=original&&!overlapping&&frame.ordinal>startOrdinal&&end<endOrdinal
    ?classifyExternalExec({...frame,nativeBindings},{...binding,plannerServer:original.server})
    :{callId:frame.callId,inputSha256:sha(frame.rawInput),status:frame.completion?.status??'unknown',classification:'DENIED',effectScope:'UNKNOWN',reasonCode:overlapping?'AMBIGUOUS_EXEC_FRAME':'ORIGINAL_NATIVE_START_UNVERIFIED',matchedNativeCallIds:[]};
   external.push({callId:frame.callId,ordinal:frame.ordinal,inputSha256:sha(frame.rawInput),completionOrdinal:frame.completion?.ordinal??null,semantic});
  }
  return {external,originalStartBinding:original?{callId:original.callId,ordinal:original.ordinal,projectId:binding.projectId,taskId:binding.taskId,attemptId:binding.attemptId,workItemId:binding.workItemId,keySha256:binding.keySha256,leaseSha256:binding.leaseSha256,approvalSha256:sha(original.privateStartArguments.approvalReference),canonicalSnapshotSha256:binding.snapshotSha256,publisherActorSha256:sha(binding.actorId)}:null,
   unaccountedNativeCallIds:all.filter(v=>!used.has(v.callId)||v.ordinal<=startOrdinal||v.ordinal>=endOrdinal).map(v=>v.callId),nativeWireKinds:[...wireKinds].map(([kind,count])=>({kind,count}))};
 }
 return {observe,finish};
}
module.exports={createNativeSourceIndex};
